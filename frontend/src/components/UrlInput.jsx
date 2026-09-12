export default function UrlInput({ url, setUrl, file, setFile, captions, setCaptions, onSubmit, disabled }) {
  return <form className="url-form" onSubmit={onSubmit}>
    <label htmlFor="youtube-url">YouTube source or authorized campaign MP4</label>
    <div className="input-row"><input id="youtube-url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://youtube.com/watch?v=..." disabled={disabled || Boolean(file)} /><button type="submit" disabled={disabled || (!url.trim() && !file)}>{disabled ? 'Working...' : file ? 'Analyze Gameplay' : 'Generate Clips'} <span>→</span></button></div>
    <div className="file-row"><label htmlFor="gameplay-file">Select local gameplay video</label><input id="gameplay-file" type="file" accept="video/mp4,.mp4" onChange={(event) => setFile(event.target.files?.[0] || null)} disabled={disabled} />{file && <span>{file.name}</span>}</div>
    <label className="caption-toggle"><input type="checkbox" checked={captions} onChange={(event) => setCaptions(event.target.checked)} disabled={disabled} /> Burn captions into clips</label>
  </form>;
}