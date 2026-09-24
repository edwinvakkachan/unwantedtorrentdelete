const axios = require('axios');
const { MongoClient } = require('mongodb');
require('dotenv').config();

const QBIT_URL = process.env.QBIT_URL;
const QBIT_USERNAME = process.env.QBIT_USERNAME;
const QBIT_PASSWORD = process.env.QBIT_PASSWORD;

const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB = process.env.MONGO_DB;
const MONGO_COLLECTION = process.env.MONGO_COLLECTION || 'keywords';

const DELETE_FILES = process.env.DELETE_FILES === 'true';


// ======================================================
// Check whether qBittorrent is available
// ======================================================

async function checkQbitAvailability() {
    console.log(`Checking qBittorrent: ${QBIT_URL}`);

    try {
        const response = await axios.get(
            `${QBIT_URL}/api/v2/app/version`,
            {
                timeout: 5000,
            }
        );

        console.log(
            `✓ qBittorrent is available`
        );

        console.log(
            `  Version: ${response.data}`
        );

        return true;

    } catch (error) {

        console.error(
            `✗ qBittorrent is NOT available`
        );

        if (error.code === 'ECONNREFUSED') {
            console.error('  Connection refused.');
        } else if (error.code === 'ETIMEDOUT') {
            console.error('  Connection timed out.');
        } else if (error.code === 'ENOTFOUND') {
            console.error('  Host could not be found.');
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
        withCredentials: true,
        timeout: 10000,
    });

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

    console.log('✓ Logged into qBittorrent');

    return client;
}


// ======================================================
// Get keywords from MongoDB
// ======================================================

async function getKeywordsFromMongo() {

    const client = new MongoClient(MONGO_URI);

    try {

        await client.connect();

        console.log('✓ Connected to MongoDB Atlas');

        const db = client.db(MONGO_DB);

        const collection =
            db.collection(MONGO_COLLECTION);

        const documents =
            await collection.find({}).toArray();

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

        // Remove duplicates
        return [...new Set(keywords)];

    } finally {

        await client.close();

    }
}


// ======================================================
// Main
// ======================================================

async function main() {

    console.log('\n================================');
    console.log(' qBittorrent Keyword Cleanup');
    console.log('================================\n');


    // --------------------------------------------------
    // STEP 1: Check qBittorrent FIRST
    // --------------------------------------------------

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


    // --------------------------------------------------
    // STEP 2: Login
    // --------------------------------------------------

    let qbit;

    try {

        qbit = await loginToQbit();

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


    // --------------------------------------------------
    // STEP 3: Get keywords from MongoDB
    // --------------------------------------------------

    let keywords;

    try {

        keywords =
            await getKeywordsFromMongo();

    } catch (error) {

        console.error(
            '\n✗ Could not read MongoDB'
        );

        console.error(error.message);

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
        console.log(`  - ${keyword}`);
    });


    // --------------------------------------------------
    // STEP 4: Get torrents
    // --------------------------------------------------

    const response =
        await qbit.get(
            '/api/v2/torrents/info'
        );

    const torrents = response.data;

    console.log(
        `\n✓ qBittorrent contains ${torrents.length} torrent(s)`
    );


    // --------------------------------------------------
    // STEP 5: Find matching torrents
    // --------------------------------------------------

    const matches = torrents.filter(torrent => {

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


    // --------------------------------------------------
    // STEP 6: Display matches
    // --------------------------------------------------

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
            `   Size: ${(torrent.size / 1024 / 1024).toFixed(2)} MB`
        );

        console.log(
            `   State: ${torrent.state}`
        );

        console.log('');
    });


    // --------------------------------------------------
    // STEP 7: Delete matching torrents
    // --------------------------------------------------

    const hashes =
        matches
            .map(torrent => torrent.hash)
            .join('|');

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

    console.log('\nDone.');
}


main().catch(error => {

    console.error(
        '\nUnexpected error:'
    );

    console.error(
        error.response?.data ||
        error.message
    );

});