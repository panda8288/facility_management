const express = require("express");
const { MessagingResponse } = require("twilio").twiml;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: false }));

app.post("/webhook", (req, res) => {
  console.log("Incoming:", req.body.Body);

  const twiml = new MessagingResponse();
  twiml.message("✅ Complaint received. We’re on it!");

  res.writeHead(200, { "Content-Type": "text/xml" });
  res.end(twiml.toString());
});

app.get("/", (req, res) => {
  res.send("Server is running");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
