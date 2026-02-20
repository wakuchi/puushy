const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const uploadStatus = document.getElementById('upload-status');
const result = document.getElementById('result');
const filename = document.getElementById('filename');
const shareLink = document.getElementById('share-link');
const copyBtn = document.getElementById('copy-btn');
const downloadCount = document.getElementById('download-count');
const downloadPageLink = document.getElementById('download-page-link');

dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        uploadFile(files[0]);
    }
});

fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
        uploadFile(fileInput.files[0]);
    }
});

async function uploadFile(file) {
    dropZone.classList.add('hidden');
    uploadStatus.classList.remove('hidden');

    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch('/upload', {
            method: 'POST',
            body: formData
        });

        if (!res.ok) {
            throw new Error('Upload failed');
        }

        const data = await res.json();
        
        const fullLink = `${window.location.origin}${data.link}`;
        
        filename.textContent = data.filename;
        shareLink.value = fullLink;
        downloadCount.textContent = '0';
        downloadPageLink.href = data.link;

        uploadStatus.classList.add('hidden');
        result.classList.remove('hidden');
        
        pollDownloadCount(data.id);
    } catch (e) {
        alert('Upload failed: ' + e.message);
        dropZone.classList.remove('hidden');
        uploadStatus.classList.add('hidden');
    }
}

copyBtn.addEventListener('click', async () => {
    shareLink.select();
    shareLink.setSelectionRange(0, 99999);
    
    try {
        await navigator.clipboard.writeText(shareLink.value);
        copyBtn.textContent = 'Copied!';
        copyBtn.classList.add('copied');
        setTimeout(() => {
            copyBtn.textContent = 'Copy';
            copyBtn.classList.remove('copied');
        }, 2000);
    } catch {
        shareLink.select();
        document.execCommand('copy');
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
            copyBtn.textContent = 'Copy';
        }, 2000);
    }
});

function pollDownloadCount(fileId) {
    setInterval(async () => {
        try {
            const res = await fetch(`/api/info/${fileId}`);
            if (res.ok) {
                const data = await res.json();
                downloadCount.textContent = data.downloads;
            }
        } catch {}
    }, 5000);
}
