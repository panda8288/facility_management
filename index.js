// index.js require("dotenv").config();

const express = require("express"); 
const { Pool } = require("pg"); 
const twilio = require("twilio");
const axios = require("axios");
//const bucket = require("./firebase");
const admin = require("firebase-admin");
module.exports=bucket;
const app = express(); app.use(express.urlencoded({ extended: false }));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const STAFF_NUMBERS = ["+918390620818", "+919923508168"];

app.post("/webhook", async (req, res) => { const incomingMsg = (req.body.Body || "").trim(); const phone = req.body.From.replace("whatsapp:", "");

const MessagingResponse = twilio.twiml.MessagingResponse; const twiml = new MessagingResponse();

try { // 1. Check onboarding state 
  const onboarding = await pool.query( "SELECT * FROM onboarding WHERE phone = $1", [phone] );

if (onboarding.rows.length > 0) {
  const step = onboarding.rows[0].step;

  if (step === "awaiting_flat") {
    const flat = incomingMsg.toUpperCase();

    const resident = await pool.query(
      "INSERT INTO residents (phone, flat_number) VALUES ($1, $2) RETURNING id",
      [phone, flat]
    );

    await pool.query("DELETE FROM onboarding WHERE phone = $1", [phone]);

    twiml.message(`✅ Registered!

Flat: ${flat}

You can now report issues 👍`); }

res.type("text/xml").send(twiml.toString());
  return;
}

// 2. Check if resident exists
const user = await pool.query(
  "SELECT * FROM residents WHERE phone = $1",
  [phone]
);

if (user.rows.length === 0) {
  await pool.query(
    "INSERT INTO onboarding (phone, step) VALUES ($1, 'awaiting_flat')",
    [phone]
  );

  twiml.message("👋 Welcome! Please enter your flat number (e.g. A-101)");
  res.type("text/xml").send(twiml.toString());
  return;
}

const resident = user.rows[0];

// 3. Staff done flow
const msgLower = incomingMsg.toLowerCase();

if (msgLower.startsWith("done")) {
  if (!STAFF_NUMBERS.includes(phone)) {
    twiml.message("❌ Not authorized");
  } else {
    const parts = msgLower.split(" ");
    const ticketId = parts[1]?.replace("#", "");

    const result = await pool.query(
      "UPDATE complaints SET status = 'closed', awaiting_rating = true WHERE id = $1 RETURNING resident_id",
      [ticketId]
    );

    if (result.rowCount === 0) {
      twiml.message("❌ Ticket not found");
    } else {
      const residentId = result.rows[0].resident_id;

      // fetch resident phone
      const resUser = await pool.query(
        "SELECT phone FROM residents WHERE id = $1",
        [residentId]
      );

      const userPhone = resUser.rows[0].phone;

      // send message to USER (not staff)
      const client = require("twilio")(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

      await client.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: `whatsapp:${userPhone}`,
        body: `✅ Your complaint (Ticket #${ticketId}) is resolved.

Please rate: 😡 😕 😐 🙂 😄` });

// confirm to staff
      twiml.message(`✅ Ticket #${ticketId} closed & user notified`);
    }
  }

  res.type("text/xml").send(twiml.toString());
  return;
}

// 4. Image handling (before rating & complaint)
// ================= IMAGE HANDLING =================
const numMedia = Number(req.body.NumMedia);

if (numMedia > 0) {
  const mediaUrl = req.body.MediaUrl0;
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

// 5. Create complaint
const result = await pool.query(
  "INSERT INTO complaints (resident_id, message) VALUES ($1, $2) RETURNING id",
  [resident.id, incomingMsg]
);

const ticketId = result.rows[0].id;

twiml.message(`✅ Complaint registered!\nTicket ID: #${ticketId}`);

res.type("text/xml").send(twiml.toString());

} catch (err) { console.error(err); twiml.message("⚠️ Error occurred"); res.type("text/xml").send(twiml.toString()); } });

app.listen(process.env.PORT || 3000, () => { console.log("Server running"); });
