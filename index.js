// index.js require("dotenv").config();

const express = require("express"); const { Pool } = require("pg"); const twilio = require("twilio");

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
const msgLower = incomingMsg.toLowerCase().trim();
const doneMatch = msgLower.match(/^done\s+#?(\d+)$/);
if (doneMatch) {
  if (!STAFF_NUMBERS.includes(phone)) {
    twiml.message("❌ Not authorized");
    return res.type("text/xml").send(twiml.toString());
  }

  const ticketId = doneMatch[1];

  const result = await pool.query(
    "UPDATE complaints SET status = 'closed', awaiting_rating = true WHERE id = $1 RETURNING resident_id",
    [ticketId]
  );

  if (result.rowCount === 0) {
    twiml.message("❌ Ticket not found");
    return res.type("text/xml").send(twiml.toString());
  }

  const residentId = result.rows[0].resident_id;

  const resUser = await pool.query(
    "SELECT phone FROM residents WHERE id = $1",
    [residentId]
  );

  const userPhone = resUser.rows[0].phone;

  const client = require("twilio")(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );

  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to: `whatsapp:${userPhone}`,
    body: `✅ Your complaint (Ticket #${ticketId}) is resolved.\n\nPlease rate: 😡 😕 😐 🙂 😄`
  });

  twiml.message(`✅ Ticket #${ticketId} closed & user notified`);

  return res.type("text/xml").send(twiml.toString()); // 🚨 MUST RETURN
}


// 4. Rating flow
const emojiMap = {
  "😡": 1,
  "😕": 2,
  "😐": 3,
  "🙂": 4,
  "😄": 5
};

const rating = emojiMap[incomingMsg];

if (rating) {
  const pending = await pool.query(
    `SELECT id FROM complaints WHERE resident_id = $1 AND awaiting_rating = true ORDER BY created_at DESC LIMIT 1`,
    [resident.id]
  );

  if (pending.rows.length > 0) {
    const ticketId = pending.rows[0].id;

    await pool.query(
      "UPDATE complaints SET rating = $1, awaiting_rating = false WHERE id = $2",
      [rating, ticketId]
    );

    twiml.message("🙏 Thanks for your feedback!");

    res.type("text/xml").send(twiml.toString());
    return;
  }
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
