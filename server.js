const axios = require('axios');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const QBIT_URL = process.env.QBIT_URL;
const QBIT_USERNAME = process.env.QBIT_USERNAME;
const QBIT_PASSWORD = process.env.QBIT_PASSWORD;

const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB = process.env.MONGO_DB;
const MONGO_COLLECTION =
    process.env.MONGO_COLLECTION || 'keywords';

const DELETE_FILES =
    process.env.DELETE_FILES === 'true';


// ======================================================
// Check whether qBittorrent is available
// ======================================================

async function checkQbitAvailability() {

    console.log(
        `Checking qBittorrent: ${QBIT_URL}`
    );

    try {

        const response = await axios.get(
            `${QBIT_URL}/api/v2/app/version`,
            {
                timeout: 5000,
                validateStatus: () => true,
            }
        );

        console.log(
            '✓ qBittorrent responded'
        );

        console.log(
            `  HTTP status: ${response.status}`
        );

        if (response.status === 200) {

            console.log(
                `  Version: ${response.data}`
            );

            return true;
        }

        if (response.status === 403) {

            console.log(
                '⚠ qBittorrent is reachable but returned 403'
            );

            console.log(
                '  Continuing to the login test...'
            );

            return true;
        }

        console.error(
            `✗ Unexpected HTTP status: ${response.status}`
        );

        return false;

    } catch (error) {

        console.error(
            '✗ qBittorrent is NOT reachable'
        );

        if (error.code === 'ECONNREFUSED') {

            console.error(
                '  Connection refused.'
            );

        } else if (error.code === 'ETIMEDOUT') {

            console.error(
                '  Connection timed out.'
            );

        } else if (error.code === 'ENOTFOUND') {

            console.error(
                '  Host could not be found.'
            );

        } else {

            console.error(
                `  ${error.message}`
            );
        }

        return false;
    }
}


// ======================================================
// Login to qBittorrent
// ======================================================

async function loginToQbit() {

    const client = axios.create({
        baseURL: QBIT_URL,
        timeout: 15000,
    });

    console.log(
        '\nLogging into qBittorrent...'
    );

    const response = await client.post(
        '/api/v2/auth/login',
        new URLSearchParams({
            username: QBIT_USERNAME,
            password: QBIT_PASSWORD,
        }),
        {
            headers: {
                'Content-Type':
                    'application/x-www-form-urlencoded',
            },
        }
    );

    if (response.data !== 'Ok.') {

        throw new Error(
            `qBittorrent login failed: ${response.data}`
        );
    }


    // --------------------------------------------------
    // Get SID cookie returned by qBittorrent
    // --------------------------------------------------

    const cookies =
        response.headers['set-cookie'];

    if (!cookies || cookies.length === 0) {

        throw new Error(
            'qBittorrent login succeeded but no cookie was returned.'
        );
    }


    const sidCookie =
        cookies.find(cookie =>
            cookie.startsWith('SID=')
        );

    if (!sidCookie) {

        throw new Error(
            'qBittorrent login succeeded but SID cookie was not found.'
        );
    }


    const sid =
        sidCookie.split(';')[0];


    // --------------------------------------------------
    // Send SID with every future request
    // --------------------------------------------------

    client.defaults.headers.common['Cookie'] =
        sid;


    console.log(
        '✓ Logged into qBittorrent'
    );

    console.log(
        '✓ qBittorrent SID cookie received'
    );


    return client;
}


// ======================================================
// Get keywords from MongoDB
// ======================================================

async function getKeywordsFromMongo() {

    const client =
        new MongoClient(MONGO_URI);

    try {

        await client.connect();

        console.log(
            '✓ Connected to MongoDB Atlas'
        );

        const db =
            client.db(MONGO_DB);

        const collection =
            db.collection(MONGO_COLLECTION);

        const documents =
            await collection
                .find({})
                .toArray();


        const keywords = documents

            .map(doc => doc.keyword)

            .filter(
                keyword =>
                    typeof keyword === 'string' &&
                    keyword.trim() !== ''
            )

            .map(keyword =>
                keyword.trim().toLowerCase()
            );


        // Remove duplicate keywords

        return [
            ...new Set(keywords)
        ];

    } finally {

        await client.close();
    }
}


// ======================================================
// Get torrents from qBittorrent
// ======================================================

async function getTorrents(qbit) {

    console.log(
        '\nGetting torrents from qBittorrent...'
    );

    try {

        const response =
            await qbit.get(
                '/api/v2/torrents/info'
            );


        console.log(
            `✓ qBittorrent returned HTTP ${response.status}`
        );


        if (!Array.isArray(response.data)) {

            throw new Error(
                'qBittorrent returned an unexpected response.'
            );
        }


        return response.data;

    } catch (error) {

        console.error(
            '\n✗ Failed to get torrents from qBittorrent'
        );

        console.error(
            `  HTTP status: ${
                error.response?.status || 'none'
            }`
        );

        console.error(
            `  Response: ${
                typeof error.response?.data === 'string'
                    ? JSON.stringify(error.response.data)
                    : JSON.stringify(
                        error.response?.data,
                        null,
                        2
                    )
            }`
        );

        console.error(
            `  Error code: ${error.code || 'none'}`
        );

        console.error(
            `  Error message: ${error.message}`
        );

        throw error;
    }
}


// ======================================================
// Delete torrents
// ======================================================

async function deleteTorrents(
    qbit,
    matches
) {

    const hashes =
        matches
            .map(torrent => torrent.hash)
            .join('|');


    console.log(
        `\nDeleting ${matches.length} torrent(s)...`
    );


    try {

        const response =
            await qbit.post(
                '/api/v2/torrents/delete',

                new URLSearchParams({
                    hashes,

                    deleteFiles:
                        DELETE_FILES
                            ? 'true'
                            : 'false',
                }),

                {
                    headers: {
                        'Content-Type':
                            'application/x-www-form-urlencoded',
                    },
                }
            );


        console.log(
            `✓ Delete API returned HTTP ${response.status}`
        );


        console.log(
            `✓ Deleted ${matches.length} torrent(s)`
        );


        if (DELETE_FILES) {

            console.log(
                '⚠ Downloaded files were also deleted.'
            );

        } else {

            console.log(
                '✓ Downloaded files were kept.'
            );
        }

    } catch (error) {

        console.error(
            '\n✗ Failed to delete torrents'
        );

        console.error(
            `  HTTP status: ${
                error.response?.status || 'none'
            }`
        );

        console.error(
            `  Response: ${
                typeof error.response?.data === 'string'
                    ? JSON.stringify(error.response.data)
                    : JSON.stringify(
                        error.response?.data,
                        null,
                        2
                    )
            }`
        );

        throw error;
    }
}


// ======================================================
// Main
// ======================================================

async function main() {

    console.log(
        '\n================================'
    );

    console.log(
        ' qBittorrent Keyword Cleanup'
    );

    console.log(
        '================================\n'
    );


    // ==================================================
    // STEP 1
    // Check qBittorrent FIRST
    // ==================================================

    const qbitAvailable =
        await checkQbitAvailability();


    if (!qbitAvailable) {

        console.log(
            '\nqBittorrent is unavailable.'
        );

        console.log(
            'Script stopped. Nothing was changed.'
        );

        process.exit(1);
    }


    // ==================================================
    // STEP 2
    // Login
    // ==================================================

    let qbit;

    try {

        qbit =
            await loginToQbit();

    } catch (error) {

        console.error(
            '\n✗ Could not login to qBittorrent'
        );

        console.error(
            error.response?.data ||
            error.message
        );

        console.log(
            '\nScript stopped. Nothing was changed.'
        );

        process.exit(1);
    }


    // ==================================================
    // STEP 3
    // MongoDB
    // ==================================================

    let keywords;

    try {

        keywords =
            await getKeywordsFromMongo();

    } catch (error) {

        console.error(
            '\n✗ Could not read MongoDB'
        );

        console.error(
            error.message
        );

        console.log(
            '\nScript stopped. Nothing was changed.'
        );

        process.exit(1);
    }


    if (keywords.length === 0) {

        console.log(
            '\nNo keywords found in MongoDB.'
        );

        return;
    }


    console.log(
        `\n✓ Loaded ${keywords.length} keyword(s):`
    );


    keywords.forEach(keyword => {

        console.log(
            `  - ${keyword}`
        );

    });


    // ==================================================
    // STEP 4
    // Get torrents
    // ==================================================

    let torrents;

    try {

        torrents =
            await getTorrents(qbit);

    } catch (error) {

        console.log(
            '\nScript stopped. Nothing was changed.'
        );

        process.exit(1);
    }


    console.log(
        `\n✓ qBittorrent contains ${torrents.length} torrent(s)`
    );


    // ==================================================
    // STEP 5
    // Find matching torrents
    // ==================================================

    const matches =
        torrents.filter(torrent => {

            const torrentName =
                torrent.name.toLowerCase();


            return keywords.some(keyword =>
                torrentName.includes(keyword)
            );

        });


    if (matches.length === 0) {

        console.log(
            '\nNo torrents matched the MongoDB keywords.'
        );

        return;
    }


    // ==================================================
    // STEP 6
    // Display matches
    // ==================================================

    console.log(
        `\n⚠ Found ${matches.length} matching torrent(s):\n`
    );


    matches.forEach((torrent, index) => {

        const matchedKeywords =
            keywords.filter(keyword =>
                torrent.name
                    .toLowerCase()
                    .includes(keyword)
            );


        console.log(
            `${index + 1}. ${torrent.name}`
        );


        console.log(
            `   Matched: ${matchedKeywords.join(', ')}`
        );


        console.log(
            `   Hash: ${torrent.hash}`
        );


        console.log(
            `   Size: ${
                (
                    torrent.size /
                    1024 /
                    1024
                ).toFixed(2)
            } MB`
        );


        console.log(
            `   State: ${torrent.state}`
        );


        console.log('');
    });


    // ==================================================
    // STEP 7
    // Delete
    // ==================================================

    try {

        await deleteTorrents(
            qbit,
            matches
        );

    } catch (error) {

        console.log(
            '\nScript stopped.'
        );

        process.exit(1);
    }


    console.log(
        '\nDone.'
    );
}


// ======================================================
// Start
// ======================================================

main().catch(error => {

    console.error(
        '\nUnexpected error:'
    );


    if (error.response) {

        console.error(
            'HTTP status:',
            error.response.status
        );

        console.error(
            'Response:',
            JSON.stringify(
                error.response.data
            )
        );

    } else {

        console.error(
            error.message
        );
    }

});