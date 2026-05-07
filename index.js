// ================= FULL WORKING CODE (Twilio + Postgres + Firebase Images) ================= require("dotenv").config();

const express = require("express"); 
const { Pool } = require("pg"); 
const twilio = require("twilio"); 
const axios = require("axios"); 
const admin = require("firebase-admin");
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken,{logLevel: 'debug'});

// ================= FIREBASE SETUP ================= 
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
console.log(serviceAccount.project_id);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount),storageBucket:serviceAccount.project_id+".firebasestorage.app"});
const bucket = admin.storage().bucket();
console.log(bucket.name);

// ================= APP SETUP ================= 
const app = express(); app.use(express.urlencoded({ extended: false }));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const STAFF_NUMBERS = ["+918390620818","+919923508168"]; // replace with your staff numbers

const SUPERVISOR_WHATSAPP='whatsapp:+918390620818';

// ================= WEBHOOK ================= 
app.post("/webhook", async (req, res) => { const incomingMsg = (req.body.Body || "").trim(); 
                                          const phone = req.body.From.replace("whatsapp:", "");

const MessagingResponse = twilio.twiml.MessagingResponse; 
                                          const twiml = new MessagingResponse();

try { console.log("Incoming:", incomingMsg); console.log("NumMedia:", req.body.NumMedia); console.log(req);



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

  twiml.message(`✅ Registered!📋\n🏠 Flat: ${flat}\n\n💬What can we help you with? `);
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

  twiml.message("👋 Welcome! Before we proceed, please enter your flat number for a 1-time registration (e.g., A-101) 🔑🚪");
  return res.type("text/xml").send(twiml.toString());
}

const resident = user.rows[0];
const msgLower = incomingMsg.toLowerCase();

// ================= STAFF DONE =================
const doneMatch = msgLower.match(/^done\s*#?(\d+)$/); //match strings that represent a command to mark an item as "done," followed by a numeric ID.

if (doneMatch) {
  if (!STAFF_NUMBERS.includes(phone)) {
    twiml.message("⛔ Not authorized!");
    return res.type("text/xml").send(twiml.toString());
  }

  const ticketId = doneMatch[1];

  const result = await pool.query(
    "UPDATE complaints SET status='closed',closed_at=NOW(), awaiting_rating=true WHERE id=$1 RETURNING resident_id",
    [ticketId]
  );

  if (result.rowCount === 0) {
    twiml.message("⚠️ Ticket not found!");
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

/*  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_NUMBER,
    to: `whatsapp:${resUser.rows[0].phone}`,
    ContentSid: 'HX6196df3261f248a01dc031ad52c7c1ca',
    ContentVariables: JSON.stringify({1: ticketId})
    //body: `Your Ticket  is resolved. ✅`
  }); */
  async function sendWhatsAppTemplate() {
  try {
    const message = await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: `whatsapp:${resUser.rows[0].phone}`,
      contentSid: 'HX76a54e7babddd94f6a5c00d91cbe62d0',
      contentVariables: JSON.stringify({
        "1": ticketId      })
    });

    console.log('Message sent successfully!');
    console.log('Message SID:', message.sid);
  } catch (error) {
    console.error('Error sending message:', error.message);
  }
}

sendWhatsAppTemplate();

  twiml.message("Ticket Closed & User notified.");
  return res.type("text/xml").send(twiml.toString());
}
// ================= FEEDBACK ===================
try {

    if (req && req.body && req.body.Body && req.body.Body.ButtonPayload !== undefined) {
        console.log("Found ButtonPayload:", req.body.Body.ButtonPayload);
        const payload = req.body.Body.ButtonPayload || '';
        const regex = /^Feedback_(Happy|Average|Unhappy)_(\d+)$/;
        const match = payload.match(regex);
        if (match) {
            const rating = match[1];
            console.log(rating);
            const ticketId = match[2];
            console.log(ticketId);
            const result = await pool.query(
            "UPDATE complaints SET rating=$1, awaiting_rating=false WHERE id=$2 RETURNING resident_id",
            [rating],[ticketId]);}
          return res.status(200).send(`Thank you for your feedback.🙏`);
 
    } else {
        console.log("ButtonPayload not found in response.");
    }
} catch (error) {
    console.error("Request failed:", error.message);
}

     
// ================= IMAGE HANDLING =================
const numMedia = Number(req.body.NumMedia);

console.log(numMedia);

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
  const flat_number = await pool.query( "SELECT flat_number from residents where id = (select resident_id from complaints where id = $1)",[result.rows[0].id]);
  console.log(flat_number);
  const message = `
📢 *New Complaint*

#️⃣ Ticket: #${result.rows[0].id}
👤 From: ${flat_number.rows[0].flat_number};
📝 Message: ${incomingMsg};
🕒 Time: ${new Date().toLocaleString()}
`;

if (!mediaUrl) {

    await client.messages.create({
  from: "whatsapp:+14155238886",
  to: SUPERVISOR_WHATSAPP,
  body: message,
});

  } else {
    console.log('In else Block');
  console.log(mediaUrl);
  await client.messages.create({
  from: "whatsapp:+14155238886",
  to: SUPERVISOR_WHATSAPP,
  body: message,
  mediaUrl:[publicUrl],
});
};

  twiml.message(`Your Complaint has been registered. Kindly use Ticket #${result.rows[0].id} for any further communication.`);
  return res.type("text/xml").send(twiml.toString());
}


     
     // ================= NORMAL COMPLAINT =================

     const result = await pool.query(
  "INSERT INTO complaints (resident_id, message) VALUES ($1,$2) RETURNING id",
  [resident.id, incomingMsg]
);

twiml.message(`Your Complaint has been registered. Kindly use Ticket #${result.rows[0].id} for any further communication.`);
     const mediaUrl = req.body.MediaUrl0;
     const flat_number = await pool.query( "SELECT flat_number from residents where id = (select resident_id from complaints where id = $1)",[result.rows[0].id]);
  const message = `
📢 *New Complaint*

#️⃣ Ticket: #${result.rows[0].id}
👤 From: ${flat_number.rows[0].flat_number};
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

res.type("text/xml").send(twiml.toString());

} catch (err) { console.error("ERROR:", err); twiml.message("Error occurred"); res.type("text/xml").send(twiml.toString()); } });

// ================= DASHBOARD =================
app.get("/dashboard", async (req, res) => {
  try {
    const total = await pool.query("SELECT COUNT(*) FROM complaints");
    const open = await pool.query("SELECT COUNT(*) FROM complaints WHERE status IS NULL OR status != 'closed'");
    const closed = await pool.query("SELECT COUNT(*) FROM complaints WHERE status = 'closed'");
    const overdue = await pool.query(`
  SELECT COUNT(*) 
  FROM complaints 
  WHERE (status IS NULL OR status != 'closed')
  AND created_at <= NOW() - INTERVAL '24 hours'
`);

    const recent = await pool.query(`
      SELECT c.id, r.flat_number, c.message, c.status, c.created_at
      FROM complaints c
      JOIN residents r ON r.id = c.resident_id
      ORDER BY c.id DESC LIMIT 10
    `);

    res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Society Dashboard</title>
  <style>
    body {
      font-family: Arial, sans-serif, "Seoge UI Emoji", "Apple Color Emoji", "Noto Color Emoji";
      background: #f4f6f8;
      margin: 0;
      padding: 20px;
    }
    h1 {
      margin-bottom: 20px;
    }
    .cards {
      display: flex;
      gap: 20px;
      margin-bottom: 30px;
    }
    .card {
      flex: 1;
      min-width:0;
      background: white;
      padding: 20px;
      border-radius: 10px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.1);
      text-align: center;
    }
    .card h2 {
      margin: 0;
      font-size: 28px;
    }
    .card p {
      margin: 5px 0 0;
      color: #666;
    }
    .card-link {
    text-decoration: none;
    color: #2c3e50;
    }
    .card-link:hover {
    color: #007bff;
    }
    .card-hover: {
    transform: translateY(-3px);
    transition:0.2s;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: white;
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 2px 6px rgba(0,0,0,0.1);
    }
    th, td {
      padding: 12px;
      text-align: left;
    }
    th {
      background: #2c3e50;
      color: white;
    }
    tr:nth-child(even) {
      background: #f2f2f2;
    }
    .status-open {
      color: red;
      font-weight: bold;
    }
    .status-closed {
      color: green;
      font-weight: bold;
    }
    .icon {
    font-size: 29px;
    margin-bottom: 8px;
    }
    .card.overdue {
  border-left: 5px solid #e74c3c;
}

.card.overdue h2 {
  color: #e74c3c;
}
  </style>
</head>
<body>

  <h1>📊 Kalpataru Jade Residences - Tower A Facility Management</h1>

  <div class="cards">
      
      <div class="card" onclick="window.open('/complaints','_blank')" style="cursor:pointer;">
      <div class="icon">🧾</div>
      <h2>${total.rows[0].count}</h2>
      <p>Total Complaints</p>
    </div>
    <div class="card" onclick="window.open('/complaints?status=open','_blank')" style="cursor:pointer;">
    <div class="icon">🔧</div>
      <h2>${open.rows[0].count}</h2>
      <p>Open</p>
    </div>
   <div class="card" onclick="window.open('/complaints?status=overdue','_blank')" style="cursor:pointer;">
    <div class="icon">⏰</div>
    <h2>${overdue.rows[0].count}</h2>
    <p>Overdue</p>
   </div>
    <div class="card">
    <div class="icon">✅</div>
      <h2>${closed.rows[0].count}</h2>
      <p>Closed</p>
    </div>
  </div>

  <h2>Recent Complaints</h2>

  <table>
    <tr>
      <th>ID</th>
      <th>Flat</th>
      <th>Message</th>
      <th>Status</th>
      <th>Time</th>
    </tr>

    ${recent.rows.map(r => `
      <tr>
        <td>#${r.id}</td>
        <td>${r.flat_number}</td>
        <td>${r.message}</td>
        <td class="${r.status === 'closed' ? 'status-closed' : 'status-open'}">
          ${r.status || "open"}
        </td>
        <td>${new Date(r.created_at).toLocaleString()}</td>
      </tr>
    `).join("")}

  </table>

</body>
</html>
`);

  } catch (err) {
    console.error(err);
    res.send("Dashboard error");
  }
});

app.get("/complaints", async (req, res) => {
  const status = req.query.status;

  let query = `
    SELECT c.id, r.flat_number, c.message, c.status, c.created_at
    FROM complaints c
    JOIN residents r ON r.id = c.resident_id
  `;

  if (status === "open") {
    query += ` WHERE c.status IS NULL OR c.status != 'closed'`;
  }
  if (status === "overdue") {
    query += ` WHERE (c.status IS NULL OR c.status != 'closed') AND c.created_at <= NOW() - INTERVAL '24 hours'`;
  }

  query += ` ORDER BY c.id DESC`;

  const result = await pool.query(query);

  res.send(`
  <html>
  <head>
    <title>Complaints</title>
    <style>
      body { font-family: Arial; padding: 20px; background:#f4f6f8; }
      table { width:100%; border-collapse: collapse; background:white; }
      th, td { padding:10px; border:1px solid #ddd; }
      th { background:#2c3e50; color:white; }
      button { padding:5px 10px; cursor:pointer; }
    </style>
  </head>
  <body>

  <h2>Complaints ${status === "open" ? "(Open Only)" : ""}</h2>

  <a href="/export${status === "open" ? "?status=open" : ""}">
    <button>⬇ Export CSV</button>
  </a>

  <br><br>

  <table>
    <tr>
      <th>ID</th><th>Flat</th><th>Message</th><th>Status</th><th>Action</th>
    </tr>

    ${result.rows.map(r => `
  <tr>
    <td>#${r.id}</td>
    <td>${r.flat_number}</td>
    <td>${r.message}</td>
    <td>${r.status || "open"}</td>
    <td>

      ${r.status !== "closed" && new Date(r.created_at) < new Date(Date.now() - 24*60*60*1000) ?  `
        <form method="POST" action="/close/${r.id}">
          <button onclick="return confirm('Close this ticket?')">Close</button>
        </form>
      ` : ""}

      ${r.status === "closed" ? `
        <form method="POST" action="/reopen/${r.id}">
          <button onclick="return confirm('Reopen this ticket?')">Reopen</button>
        </form>
      ` : ""}

    </td>
  </tr>
`).join("")}

  </table>

  </body>
  </html>
  `);
});

app.post("/close/:id", async (req, res) => {
  const id = req.params.id;

  await pool.query(
    "UPDATE complaints SET status='closed', closed_at=NOW() WHERE id=$1",
    [id]
  );

  res.redirect("/complaints");
});

app.get("/export", async (req, res) => {
  const status = req.query.status;

  let query = `
    SELECT 
  c.id, 
  r.flat_number, 
  c.message, 
  c.status, 
  c.created_at,
  c.closed_at,
  (c.closed_at >= NOW() - INTERVAL '24 hours') AS can_reopen
FROM complaints c
JOIN residents r ON r.id = c.resident_id
  `;

  if (status === "open") {
    query += ` WHERE c.status IS NULL OR c.status != 'closed'`;
  }

  const result = await pool.query(query);

  let csv = "ID,Flat,Message,Status,Time\n";

  result.rows.forEach(r => {
    csv += `${r.id},${r.flat_number},"${r.message}",${r.status || "open"},${r.created_at}\n`;
  });

  res.header("Content-Type", "text/csv");
  res.attachment("complaints.csv");
  return res.send(csv);
});

// ================= REOPEN =================
app.post("/reopen/:id", async (req, res) => {
  const id = req.params.id;

  const result = await pool.query(
    `UPDATE complaints
     SET status='reopened'
     WHERE id=$1
     AND status='closed'
     AND closed_at >= NOW() - INTERVAL '24 hours'
     RETURNING id`,
    [id]
  );

  if (result.rowCount === 0) {
    return res.send("⛔ Cannot reopen (24hr window passed or invalid ticket)");
  }

  res.redirect("/complaints");
});

app.listen(process.env.PORT || 3000, () => { console.log("Server running"); });
