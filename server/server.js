require('dotenv').config();
const express = require('express');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const mongoose = require('mongoose'); // <--- NEW IMPORT

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use('/uploads', express.static('uploads'));

// --- 1. MONGODB ATLAS CONNECTION ---
// PASTE YOUR ATLAS CONNECTION STRING HERE
const MONGO_URI = "mongodb+srv://admin:admin1806@cluster0.m6pibb1.mongodb.net/?appName=Cluster0";

// Define the Schema globally
let AuditLog;

if (MONGO_URI.includes("<password>")) {
    console.warn("⚠️  WARNING: You haven't replaced the MONGO_URI placeholder yet. Database logging will be skipped.");
} else {
    mongoose.connect(MONGO_URI)
        .then(() => console.log("✅ Connected to MongoDB Atlas"))
        .catch(err => console.error("❌ MongoDB Atlas Error:", err));

    const auditSchema = new mongoose.Schema({
        originalHash: String,
        finalHash: String,
        timestamp: { type: Date, default: Date.now },
        fileName: String,
        fieldsCount: Number
    });
    AuditLog = mongoose.model('AuditLog', auditSchema);
}

// --- HELPERS ---
const calculateHash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const calculateFittedImage = (box, imgDims) => {
  const { x, y, width: boxW, height: boxH } = box;
  const { width: imgW, height: imgH } = imgDims;
  const scale = Math.min(boxW / imgW, boxH / imgH);
  const newW = imgW * scale;
  const newH = imgH * scale;
  return { x: x + (boxW - newW) / 2, y: y + (boxH - newH) / 2, width: newW, height: newH };
};

const drawWrappedText = (text, x, topY, boxWidth, size, font, page) => {
  if (!text) return;
  const words = text.split(' ');
  let line = '';
  let currentY = topY - size; 
  const lineHeight = size * 1.4; 
  const effectiveWidth = boxWidth - 10; 

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const testWidth = font.widthOfTextAtSize(testLine, size);
    if (testWidth > effectiveWidth && n > 0) {
      page.drawText(line.trim(), { x, y: currentY, size, font, color: rgb(0,0,0) });
      line = words[n] + ' ';
      currentY -= lineHeight;
    } else { line = testLine; }
  }
  page.drawText(line.trim(), { x, y: currentY, size, font, color: rgb(0,0,0) });
};

// --- API ENDPOINT ---
app.post('/api/sign-pdf', async (req, res) => {
  try {
    const { pdfBase64, fields } = req.body;

    // 1. Validate Upload
    if (!pdfBase64) return res.status(400).json({ error: "No PDF file provided" });

    const pdfBuffer = Buffer.from(pdfBase64.split(',')[1], 'base64');
    const originalHash = calculateHash(pdfBuffer);

    // 2. Load & Modify PDF
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const firstPage = pdfDoc.getPages()[0];
    const { width: pageWidth, height: pageHeight } = firstPage.getSize();
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

    for (const field of fields) {
      const box = {
        x: (field.x / 100) * pageWidth,
        y: pageHeight - ((field.y / 100) * pageHeight) - ((field.height / 100) * pageHeight),
        width: (field.width / 100) * pageWidth,
        height: (field.height / 100) * pageHeight
      };

      if ((field.type === 'Image' || field.type === 'Signature') && field.value?.startsWith('data:image')) {
          try {
            const imgBuffer = Buffer.from(field.value.split(',')[1], 'base64');
            let embeddedImage = field.value.includes('png') ? await pdfDoc.embedPng(imgBuffer) : await pdfDoc.embedJpg(imgBuffer);
            const drawSettings = calculateFittedImage(box, embeddedImage.scale(1));
            firstPage.drawImage(embeddedImage, drawSettings);
          } catch (e) { console.warn("Image Error", e); }
      }
      else if (field.type === 'Text' || field.type === 'Date') {
          drawWrappedText(field.value || "", box.x + 2, box.y + box.height, box.width, 12, helveticaFont, firstPage);
      }
      else if (field.type === 'Radio') {
          firstPage.drawRectangle({ x: box.x, y: box.y, width: box.width, height: box.height, borderColor: rgb(0,0,0), borderWidth: 1 });
          if (field.value) firstPage.drawText("X", { x: box.x + 4, y: box.y + 4, size: 12, font: helveticaFont });
      }
    }

    // 3. Finalize
    const signedPdfBytes = await pdfDoc.save();
    const signedPdfBuffer = Buffer.from(signedPdfBytes);
    const finalHash = calculateHash(signedPdfBuffer);

    const fileName = `signed_${Date.now()}.pdf`;
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    fs.writeFileSync(path.join(uploadDir, fileName), signedPdfBuffer);

    // --- 4. PARALLEL LOGGING (Disk + Cloud) ---
    
    // A. Log to JSON File (Local Backup)
    const auditEntry = {
      id: Date.now(),
      originalHash,
      finalHash,
      timestamp: new Date().toISOString(),
      file: fileName,
      fieldsCount: fields.length
    };
    const auditPath = path.join(__dirname, 'audit_log.json');
    let logs = [];
    if (fs.existsSync(auditPath)) { try { logs = JSON.parse(fs.readFileSync(auditPath)); } catch (e) {} }
    logs.push(auditEntry);
    fs.writeFileSync(auditPath, JSON.stringify(logs, null, 2));

    // B. Log to MongoDB Atlas (Cloud)
    // We wrap this in a try-catch so a DB error doesn't stop the user from getting their PDF
    if (AuditLog) {
        try {
            const newLog = new AuditLog({
                originalHash,
                finalHash,
                fileName,
                fieldsCount: fields.length
            });
            await newLog.save();
            console.log("✅ Audit logged to MongoDB Atlas");
        } catch (dbErr) {
            console.error("⚠️ Failed to log to MongoDB:", dbErr.message);
        }
    }

    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const host = req.get('host'); // Gets 'my-app.onrender.com' or 'localhost:5000'
    const fullUrl = `${protocol}://${host}/uploads/${fileName}`;

    res.json({
      success: true,
      url: fullUrl, 
      auditTrail: { originalHash, finalHash }
    });

  } catch (error) {
    console.error("Backend Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));