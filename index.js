const STAFF_NUMBERS = [ "+918390620818", "+919923508168"];

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
  const incomingMsg = req.body.Body.trim().toLowerCase();
  const phone = req.body.From.replace("whatsapp:", "");

  const { MessagingResponse } = require("twilio").twiml;
  const twiml = new MessagingResponse();

  try {
    const user = await pool.query("SELECT * FROM residents WHERE phone=$1",[phone]);
  const resident=user.rows[0];
  const residentId=resident.id;
  if (resident.rowCount===0) {
            twiml.message(`Please enter your flat number (e.g. A-01`);
          } else {
          

const state = await pool.query(
  "SELECT step from onboarding WHERE phone = $1",[phone]);
const user_state = state.step;
if ( user_state === 'awaiting_flat') {
  await pool.query(
  "UPDATE  residents (flat_number) SET VALUES($1)",[]);
}
await pool.query(
  "INSERT INTO complaints(resident_id,message) VALUES($1,$2)",[residentId,message]);
          }
    //   REOPEN COMMAND: reopen <id>
    if (incomingMsg.startsWith("reopen")) {
      const parts = incomingMsg.split(" ");
      const ticketId = parts[1];
      if (!ticketId) {
          twiml.message("⚠️ Please provide ticket ID. Example: done 12");
        } else {
          const result = await pool.query(
            "UPDATE complaints SET status = 'reopend' WHERE id = $1 RETURNING id",
            [ticketId]
          );
        if (result.rowCount === 0) {
            twiml.message(`❌ Ticket #${ticketId} not found`);
          } else {
            twiml.message(`✅ Your Ticket #${ticketId} is marked as reopened.`);
          }
        }
    }
    else {

    // 🧠 STAFF COMMAND: done <id>
    if (incomingMsg.startsWith("done")) {
      
      if (!STAFF_NUMBERS.includes(phone)) {
        twiml.message("❌ You are not authorized to close tickets");
      } else {
        const parts = incomingMsg.split(" ");
        const ticketId = parts[1];

        if (!ticketId) {
          twiml.message("⚠️ Please provide ticket ID. Example: done 12");
        } else {
          const result = await pool.query(
            "UPDATE complaints SET status = 'closed' WHERE id = $1 RETURNING id",
            [ticketId]
          );

          if (result.rowCount === 0) {
            twiml.message(`❌ Ticket #${ticketId} not found`);
          } else {
            twiml.message(`✅ Your Ticket #${ticketId} is marked as resolved. If not satisfied with the service, kindly reply with "reopen ${ticketId}"`);
          }
        }
      }

    } else {
      // 🧾 NORMAL COMPLAINT FLOW
      const message = req.body.Body || "No message";

      const result = await pool.query(
        "INSERT INTO complaints (phone, message) VALUES ($1, $2) RETURNING id",
        [phone, message]
      );

      const ticketId = result.rows[0].id;

      twiml.message(`✅ Complaint registered!\nTicket ID: #${ticketId}`);
    }
    }

    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end(twiml.toString());

  } catch (err) {
    console.error(err);
    twiml.message("⚠️ Something went wrong");

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
