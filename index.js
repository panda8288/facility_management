const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});
const express = require("express");
const { MessagingResponse } = require("twilio").twiml;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: false }));

app.post("/webhook", async (req, res) => {
  const message = req.body.Body;
  const phone = req.body.From.replace("whatsapp:", "");

  console.log("Incoming:", message);

  try {
    const result = await pool.query(
      "INSERT INTO complaints (phone, message) VALUES ($1, $2) RETURNING id",
      [phone, message]
    );

    const ticketId = result.rows[0].id;

    const { MessagingResponse } = require("twilio").twiml;
    const twiml = new MessagingResponse();

    twiml.message(`✅ Complaint registered!\nTicket ID: #${ticketId}`);

    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end(twiml.toString());

  } catch (err) {
    console.error("DB ERROR:", err);

    const twiml = new (require("twilio").twiml.MessagingResponse)();
    twiml.message("⚠️ Something went wrong. Please try again.");

    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end(twiml.toString());
  }
});
app.get("/", (req, res) => {
  res.send("Server is running");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
