// ================= FULL WORKING CODE (Twilio + Postgres + Firebase Images) ================= require("dotenv").config();

const express = require("express"); 
const { Pool } = require("pg"); 
const twilio = require("twilio"); 
const axios = require("axios"); 
const admin = require("firebase-admin");
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

// ================= FIREBASE SETUP ================= 
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
console.log(serviceAccount.project_id);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount),storageBucket:serviceAccount.project_id+".firebasestorage.app"});
const bucket = admin.storage().bucket();
console.log(bucket.name);

// ================= APP SETUP ================= 
const app = express(); app.use(express.urlencoded({ extended: false }));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const STAFF_NUMBERS = ["918390620818","919923508168"]; // replace with your staff numbers

const SUPERVISOR_WHATSAPP='whatsapp:+918390620818';

// ================= WEBHOOK ================= 
app.post("/webhook", async (req, res) => { const incomingMsg = (req.body.Body || "").trim(); 
                                          const phone = req.body.From.replace("whatsapp:", "");

const MessagingResponse = twilio.twiml.MessagingResponse; 
                                          const twiml = new MessagingResponse();

try { console.log("Incoming:", incomingMsg); console.log("NumMedia:", req.body.NumMedia);

// ================= ONBOARDING =================
const onboarding = await pool.query(
  "SELECT * FROM onboarding WHERE phone = $1",
  [phone]
);

if (onboarding.rows.length > 0) {
  const flat = incomingMsg.toUpperCase();

  await pool.query(
    "INSERT INTO residents (phone, flat_number) VALUES ($1, $2)",
    [phone, flat]
  );

  await pool.query("DELETE FROM onboarding WHERE phone = $1", [phone]);

  twiml.message(`✅ Registered!\nFlat: ${flat}`);
  return res.type("text/xml").send(twiml.toString());
}

// ================= RESIDENT CHECK =================
const user = await pool.query(
  "SELECT * FROM residents WHERE phone = $1",
  [phone]
);

if (user.rows.length === 0) {
  await pool.query(
    "INSERT INTO onboarding (phone, step) VALUES ($1, 'awaiting_flat')",
    [phone]
  );

  twiml.message("Enter your flat number (e.g. A-101)");
  return res.type("text/xml").send(twiml.toString());
}

const resident = user.rows[0];
const msgLower = incomingMsg.toLowerCase();

// ================= STAFF DONE =================
const doneMatch = msgLower.match(/^done\s+#?(\d+)$/);

if (doneMatch) {
  if (!STAFF_NUMBERS.includes(phone)) {
    twiml.message("Not authorized");
    return res.type("text/xml").send(twiml.toString());
  }

  const ticketId = doneMatch[1];

  const result = await pool.query(
    "UPDATE complaints SET status='closed', awaiting_rating=true WHERE id=$1 RETURNING resident_id",
    [ticketId]
  );

  if (result.rowCount === 0) {
    twiml.message("Ticket not found");
    return res.type("text/xml").send(twiml.toString());
  }

  const residentId = result.rows[0].resident_id;

  const resUser = await pool.query(
    "SELECT phone FROM residents WHERE id=$1",
    [residentId]
  );

  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );

  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to: `whatsapp:${resUser.rows[0].phone}`,
    body: `Ticket #${ticketId} resolved. Rate: 😡 😕 😐 🙂 😄`
  });

  twiml.message("Closed & user notified");
  return res.type("text/xml").send(twiml.toString());
}

// ================= IMAGE HANDLING =================
const numMedia = Number(req.body.NumMedia);
console.log(numMedia);

if (numMedia > 0) {
  const mediaUrl = req.body.MediaUrl0;
     const message = `
📢 *New Complaint*

👤 From: ${phone};
📝 Message: ${incomingMsg};
🕒 Time: ${new Date().toLocaleString()}
`;

await client.messages.create({
  from: "whatsapp:+14155238886",
  to: SUPERVISOR_WHATSAPP,
  body: message,
  mediaUrl:[mediaUrl],
});

  const mediaType = req.body.MediaContentType0;

  console.log("Downloading from Twilio...");

  const response = await axios.get(mediaUrl, {
    responseType: "arraybuffer",
    auth: {
      username: process.env.TWILIO_ACCOUNT_SID,
      password: process.env.TWILIO_AUTH_TOKEN
    }
  });

  const fileName = `complaints/${Date.now()}_${phone}.jpg`;
  const file = bucket.file(fileName);

  console.log("Uploading to Firebase...");

  await file.save(response.data, {
    metadata: { contentType: mediaType }
  });

  await file.makePublic();

  const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

  console.log("Firebase URL:", publicUrl);

  const result = await pool.query(
    "INSERT INTO complaints (resident_id, message, image_url) VALUES ($1,$2,$3) RETURNING id",
    [resident.id, incomingMsg || "(image)", publicUrl]
  );

  twiml.message(`Image complaint saved. Ticket #${result.rows[0].id}`);
  return res.type("text/xml").send(twiml.toString());
}

// ================= NORMAL COMPLAINT =================

const mediaUrl = req.body.MediaUrl0;
     const message = `
📢 *New Complaint*

👤 From: ${phone};
📝 Message: ${incomingMsg};
🕒 Time: ${new Date().toLocaleString()}
`;

if (!mediaUrl) {
    await client.messages.create({
  from: "whatsapp:+14155238886",
  to: SUPERVISOR_WHATSAPP,
  body: message,
});

  } else {await client.messages.create({
  from: "whatsapp:+14155238886",
  to: SUPERVISOR_WHATSAPP,
  body: message,
  mediaUrl:[mediaUrl],
});
};
     const result = await pool.query(
  "INSERT INTO complaints (resident_id, message) VALUES ($1,$2) RETURNING id",
  [resident.id, incomingMsg]
);

twiml.message(`Complaint registered. Ticket #${result.rows[0].id}`);
res.type("text/xml").send(twiml.toString());

} catch (err) { console.error("ERROR:", err); twiml.message("Error occurred"); res.type("text/xml").send(twiml.toString()); } });

app.listen(process.env.PORT || 3000, () => { console.log("Server running"); });
