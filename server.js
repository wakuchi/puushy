const express = require('express');
const multer = require('multer');
const shortid = require('shortid');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const Busboy = require('busboy').Busboy;

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
        console.log('DiskStorage: destination called for', file.originalname);
        cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const id = shortid.generate();
        const filename = id + path.extname(file.originalname);
        console.log('DiskStorage: filename will be', filename);
        cb(null, filename);
    }
});

const upload = multer({ 
    storage,
    limits: { 
        fileSize: 500 * 1024 * 1024,
        fields: 10,
        parts: 20
    },
    fileFilter: (req, file, cb) => {
        console.log('File filter - originalname:', file.originalname, 'mimetype:', file.mimetype);
        cb(null, true);
    }
});

app.post('/upload', (req, res) => {
    console.log('Upload request, content-length:', req.headers['content-length']);
    
    const busboy = new Busboy({ headers: req.headers });
    let fileId = null;
    let originalName = null;
    let writeStream = null;
    let fileSize = 0;
    
    busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
        console.log('Busboy: file event for', filename);
        fileId = shortid.generate();
        originalName = filename;
        const ext = path.extname(filename);
        const savedFilename = fileId + ext;
        const filepath = path.join(UPLOADS_DIR, savedFilename);
        
        console.log('Busboy: writing to', filepath);
        
        writeStream = fs.createWriteStream(filepath);
        
        file.on('data', (chunk) => {
            fileSize += chunk.length;
            console.log('Busboy: received', fileSize, 'bytes');
        });
        
        file.on('end', () => {
            console.log('Busboy: file data ended, size:', fileSize);
        });
        
        file.on('error', (err) => {
            console.error('Busboy: file stream error:', err.message);
        });
        
        file.pipe(writeStream);
        
        writeStream.on('close', () => {
            console.log('Busboy: writeStream closed');
        });
        
        writeStream.on('error', (err) => {
            console.error('Busboy: writeStream error:', err.message);
        });
    });
    
    busboy.on('finish', () => {
        console.log('Busboy: finish event fired, file size:', fileSize);
        
        if (!fileId || fileSize === 0) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        try {
            const ext = path.extname(originalName);
            const savedFilename = fileId + ext;
            
            const metadata = loadMetadata();
            metadata.files.push({
                id: fileId,
                originalName: originalName,
                filename: savedFilename,
                downloads: 0,
                createdAt: Date.now()
            });
            
            saveMetadata(metadata);
            console.log('Upload complete:', originalName, '->', savedFilename);
            
            return res.json({
                id: fileId,
                filename: originalName,
                link: `/f/${fileId}`
            });
        } catch (err) {
            console.error('Save error:', err.message);
            return res.json({
                id: fileId,
                filename: originalName,
                link: `/f/${fileId}`
            });
        }
    });
    
    busboy.on('error', (err) => {
        console.error('Busboy error:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message });
        }
    });
    
    req.pipe(busboy);
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
