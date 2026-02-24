import admin from "firebase-admin";
import fs from "fs";

const serviceAccount = JSON.parse(fs.readFileSync("./scripts/serviceAccountKey.json", "utf-8"));

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function exportCollection(collectionName) {
    const snapshot = await db.collection(collectionName).get();
    const data = [];

    snapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() });
    });

    fs.writeFileSync(
        `${collectionName}.json`,
        JSON.stringify(data, null, 2)
    );

    console.log(`${collectionName} exported successfully`);
}

async function exportAll() {
    await exportCollection("Vendor");
}

exportAll();