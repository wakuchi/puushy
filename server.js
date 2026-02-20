const express = require('express');
const shortid = require('shortid');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const formidable = require('formidable');

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

app.post('/upload', (req, res) => {
    console.log('Upload request, content-length:', req.headers['content-length']);
    
    const form = formidable({
        uploadDir: UPLOADS_DIR,
        keepExtensions: true,
        maxFileSize: 500 * 1024 * 1024,
        filename: (name, ext, part) => {
            const fileId = shortid.generate();
            return fileId + ext;
        }
    });
    
    form.parse(req, (err, fields, files) => {
        if (err) {
            console.error('Formidable error:', err.message);
            return res.status(400).json({ error: err.message });
        }
        
        const file = files.file;
        if (!file || (Array.isArray(file) && file.length === 0)) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        const uploadedFile = Array.isArray(file) ? file[0] : file;
        console.log('File uploaded:', uploadedFile.originalFilename || uploadedFile.name, 'size:', uploadedFile.size);
        
        const originalName = uploadedFile.originalFilename || uploadedFile.name;
        const savedFilename = path.basename(uploadedFile.filepath);
        const fileId = path.basename(savedFilename, path.extname(savedFilename));
        
        try {
            const metadata = loadMetadata();
            metadata.files.push({
                id: fileId,
                originalName: originalName,
                filename: savedFilename,
                downloads: 0,
                createdAt: Date.now()
            });
            
            saveMetadata(metadata);
            console.log('Upload complete:', originalName);
            
            return res.json({
                id: fileId,
                filename: originalName,
                link: `/f/${fileId}`
            });
        } catch (saveErr) {
            console.error('Save error:', saveErr.message);
            return res.json({
                id: fileId,
                filename: originalName,
                link: `/f/${fileId}`
            });
        }
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

server.listen(PORT, '0.0.0.0', () => {
    console.log(`wakuchi's puushy running on http://0.0.0.0:${PORT}`);
});
