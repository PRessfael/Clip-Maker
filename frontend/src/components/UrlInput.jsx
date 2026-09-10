export default function UrlInput({ url, setUrl, onSubmit, disabled }) {
  return <form className="url-form" onSubmit={onSubmit}>
    <label htmlFor="youtube-url">Paste YouTube URL</label>
    <div className="input-row"><input id="youtube-url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://youtube.com/watch?v=..." disabled={disabled} /><button type="submit" disabled={disabled || !url.trim()}>{disabled ? 'Working...' : 'Generate Clips'} <span>→</span></button></div>
  </form>;
}