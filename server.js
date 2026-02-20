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
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));
app.use(express.static('public'));

const server = require('http').createServer(app);
server.timeout = 120000; // 2 minute timeout

try {
    if (!fs.existsSync(UPLOADS_DIR)) {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        console.log('Created uploads directory');
    }

    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        console.log('Created data directory');
    }

    if (!fs.existsSync(METADATA_FILE)) {
        fs.writeFileSync(METADATA_FILE, JSON.stringify({ files: [] }));
        console.log('Created metadata.json');
    }
    
    console.log('Directories initialized');
} catch (err) {
    console.error('Failed to initialize directories:', err.message);
}

process.stdout.setMaxListeners(0);

function loadMetadata() {
    try {
        return JSON.parse(fs.readFileSync(METADATA_FILE, 'utf8'));
    } catch {
        return { files: [] };
    }
}

function saveMetadata(data) {
    try {
        fs.writeFileSync(METADATA_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Failed to save metadata:', err.message);
        throw err;
    }
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
    limits: { 
        fileSize: 500 * 1024 * 1024, // 500MB limit
        fields: 10,
        parts: 20
    }
});

app.post('/upload', (req, res) => {
    console.log('Upload endpoint hit at', new Date().toISOString());
    console.log('Headers:', JSON.stringify(req.headers));
    process.stdout.flush();
    
    const timeout = setTimeout(() => {
        console.error('Upload timeout - forcing response');
        if (!res.headersSent) {
            res.status(500).json({ error: 'Upload timeout' });
        }
    }, 120000);
    
    upload.single('file')(req, res, (err) => {
        clearTimeout(timeout);
        
        console.log('Multer callback, err:', err ? err.message : 'none');
        
        if (err) {
            console.error('Multer error:', err.message);
            return res.status(400).json({ error: err.message });
        }
        
        if (!req.file) {
            console.error('No file in request');
            return res.status(400).json({ error: 'No file uploaded' });
        }

        try {
            const id = path.basename(req.file.filename, path.extname(req.file.filename));
            console.log('File received:', req.file.originalname, 'size:', req.file.size);
            
            const metadata = loadMetadata();

            metadata.files.push({
                id,
                originalName: req.file.originalname,
                filename: req.file.filename,
                downloads: 0,
                createdAt: Date.now()
            });

            saveMetadata(metadata);
            console.log('Sending success response');

            return res.json({
                id,
                filename: req.file.originalname,
                link: `/f/${id}`
            });
        } catch (saveErr) {
            console.error('Save error:', saveErr.message);
            const id = path.basename(req.file.filename, path.extname(req.file.filename));
            return res.json({
                id,
                filename: req.file.originalname,
                link: `/f/${id}`
            });
        }
    });
});

app.get('/api/test', (req, res) => {
    res.json({ status: 'ok', time: Date.now() });
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

server.listen(PORT, '0.0.0.0', () => {
    console.log(`wakuchi's puushy running on http://0.0.0.0:${PORT}`);
});
