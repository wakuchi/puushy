# wakuchi's puushy

A simple file sharing service for your VPS. Upload files via drag & drop, get a shareable link, and track download counts. Files auto-delete after 1 hour.

## Features

- Drag & drop file upload
- Shareable links (e.g., `http://your-vps:3000/f/abc123`)
- Download counter
- Auto-delete after 1 hour
- Dark theme with smooth animations

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Run the Server

```bash
npm start
```

The server will start on http://localhost:3000

### 3. Deploy to VPS

```bash
# Upload files to your VPS, then:
npm install
npm start
```

For production, use PM2 to keep it running:

```bash
npm install -g pm2
pm2 start server.js --name puushy
pm2 save
```

## Usage

1. Open the webpage
2. Drag & drop a file or click to select
3. Copy the share link
4. Share the link - recipients see download page with count
5. Files auto-delete after 1 hour

## Configuration

Edit `server.js` to customize:

| Setting | Variable | Default |
|---------|----------|---------|
| Port | `PORT` env | 3000 |
| File expiry | `FILE_EXPIRY_MS` | 1 hour |

Example:
```bash
PORT=8080 npm start
```

## Project Structure

```
.
├── server.js          # Express server
├── public/
│   ├── index.html     # Upload page
│   ├── download.html  # Download page
│   ├── style.css      # Styling
│   └── script.js      # Frontend JS
├── uploads/           # Uploaded files
└── data/
    └── metadata.json  # File metadata
```

## License

MIT
