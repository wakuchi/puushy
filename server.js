const express = require('express');
const multer = require('multer');
const shortid = require('shortid');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
const METADATA_FILE = path.join(DATA_DIR, 'metadata.json');
const FILE_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

app.use(cors());
app.use(express.static('public'));

if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(METADATA_FILE)) {
    fs.writeFileSync(METADATA_FILE, JSON.stringify({ files: [] }));
}

function loadMetadata() {
    try {
        return JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8'));
    } catch {
        return { files: [] };
    }
}

function saveMetadata(data) {
    fs.writeFileSync(METADATA_FILE, JSON.stringify(data, null, 2));
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const id = shortid.generate();
        cb(null, id + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

app.post('/upload', (req, res) => {
    upload.single('file')(req, res, (err) => {
        if (err) {
            console.error('Upload error:', err.message);
            return res.status(400).json({ error: err.message });
        }
        
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const id = path.basename(req.file.filename, path.extname(req.file.filename));
        const metadata = loadMetadata();

        metadata.files.push({
            id,
            originalName: req.file.originalname,
            filename: req.file.filename,
            downloads: 0,
            createdAt: Date.now()
        });

        saveMetadata(metadata);

        res.json({
            id,
            filename: req.file.originalname,
            link: `/f/${id}`
        });
    });
});

app.get('/f/:id', (req, res) => {
    const metadata = loadMetadata();
    const file = metadata.files.find(f => f.id === req.params.id);

    if (!file) {
        return res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
    }

    res.sendFile(path.join(__dirname, 'public', 'download.html'));
});

app.get('/api/info/:id', (req, res) => {
    const metadata = loadMetadata();
    const file = metadata.files.find(f => f.id === req.params.id);

    if (!file) {
        return res.status(404).json({ error: 'File not found' });
    }

    res.json({
        id: file.id,
        filename: file.originalName,
        downloads: file.downloads,
        createdAt: file.createdAt,
        expiresAt: file.createdAt + FILE_EXPIRY_MS
    });
});

app.get('/api/download/:id', (req, res) => {
    const metadata = loadMetadata();
    const fileIndex = metadata.files.findIndex(f => f.id === req.params.id);

    if (fileIndex === -1) {
        return res.status(404).json({ error: 'File not found' });
    }

    const file = metadata.files[fileIndex];
    const filePath = path.join(UPLOADS_DIR, file.filename);

    if (!fs.existsSync(filePath)) {
        metadata.files.splice(fileIndex, 1);
        saveMetadata(metadata);
        return res.status(404).json({ error: 'File not found' });
    }

    metadata.files[fileIndex].downloads += 1;
    saveMetadata(metadata);

    res.download(filePath, file.originalName);
});

function cleanupExpiredFiles() {
    const metadata = loadMetadata();
    const now = Date.now();
    const validFiles = [];

    metadata.files.forEach(file => {
        if (now - file.createdAt > FILE_EXPIRY_MS) {
            const filePath = path.join(UPLOADS_DIR, file.filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`Deleted expired file: ${file.originalName} (${file.id})`);
            }
        } else {
            validFiles.push(file);
        }
    });

    if (validFiles.length !== metadata.files.length) {
        saveMetadata({ files: validFiles });
    }
}

setInterval(cleanupExpiredFiles, 60 * 1000);

app.listen(PORT, '0.0.0.0', () => {
    console.log(`wakuchi's puushy running on http://0.0.0.0:${PORT}`);
});
