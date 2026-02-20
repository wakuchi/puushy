const express = require('express');
const shortid = require('shortid');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
const METADATA_FILE = path.join(DATA_DIR, 'metadata.json');
const FILE_EXPIRY_MS = 60 * 60 * 1000;

app.use(cors());
app.use(express.json({ limit: '15gb' }));
app.use(express.urlencoded({ extended: true, limit: '15gb' }));
app.use(express.static('public'));

const server = require('http').createServer(app);
server.timeout = 600000;

try {
    if (!fs.existsSync(UPLOADS_DIR)) {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(METADATA_FILE)) {
        fs.writeFileSync(METADATA_FILE, JSON.stringify({ files: [] }));
    }
} catch (err) {
    console.error('Init error:', err.message);
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

app.post('/upload', (req, res) => {
    const contentLength = parseInt(req.headers['content-length'], 10);
    console.log('Upload start, size:', contentLength);
    
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(.+)/);
    
    if (!boundaryMatch) {
        return res.status(400).json({ error: 'Invalid content type' });
    }
    
    const boundary = boundaryMatch[1];
    const fileId = shortid.generate();
    let filename = 'file';
    let writeStream = null;
    let receivedBytes = 0;
    let fileStart = false;
    let headerBuffer = Buffer.alloc(0);
    
    req.on('data', (chunk) => {
        receivedBytes += chunk.length;
        
        if (!fileStart) {
            headerBuffer = Buffer.concat([headerBuffer, chunk]);
            const headerStr = headerBuffer.toString('utf8');
            const filenameMatch = headerStr.match(/filename="([^"]+)"/);
            
            if (filenameMatch) {
                filename = filenameMatch[1];
                const ext = path.extname(filename);
                const saveName = fileId + ext;
                const filepath = path.join(UPLOADS_DIR, saveName);
                
                console.log('Writing file:', filename, '->', saveName);
                writeStream = fs.createWriteStream(filepath);
                fileStart = true;
                
                const headerEndIndex = headerBuffer.indexOf('\r\n\r\n');
                if (headerEndIndex !== -1) {
                    const remaining = headerBuffer.slice(headerEndIndex + 4);
                    if (remaining.length > 0) {
                        writeStream.write(remaining);
                    }
                }
            }
        } else if (writeStream) {
            const boundaryIndex = chunk.indexOf(Buffer.from('--' + boundary));
            if (boundaryIndex !== -1) {
                writeStream.write(chunk.slice(0, boundaryIndex));
                writeStream.end();
                writeStream = null;
                
                console.log('File complete, size:', receivedBytes);
                
                const ext = path.extname(filename);
                const saveName = fileId + ext;
                
                try {
                    const metadata = loadMetadata();
                    metadata.files.push({
                        id: fileId,
                        originalName: filename,
                        filename: saveName,
                        downloads: 0,
                        createdAt: Date.now()
                    });
                    saveMetadata(metadata);
                    
                    console.log('Upload success:', filename);
                    
                    res.json({
                        id: fileId,
                        filename: filename,
                        link: `/f/${fileId}`
                    });
                } catch (err) {
                    console.error('Save error:', err.message);
                    res.json({
                        id: fileId,
                        filename: filename,
                        link: `/f/${fileId}`
                    });
                }
            } else {
                writeStream.write(chunk);
            }
        }
    });
    
    req.on('error', (err) => {
        console.error('Request error:', err.message);
        if (writeStream) {
            writeStream.end();
        }
    });
    
    req.on('end', () => {
        if (writeStream && !writeStream.writableEnded) {
            writeStream.end();
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
