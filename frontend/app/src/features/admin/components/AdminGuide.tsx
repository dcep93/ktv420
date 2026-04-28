const guideStyle = {
  border: "1px solid #d0d7de",
  borderRadius: 8,
  padding: "16px 20px",
  marginBottom: 24,
  backgroundColor: "#f6f8fa",
};

export default function AdminGuide() {
  return (
    <section style={guideStyle}>
      <h2 style={{ marginTop: 0 }}>Admin user guide</h2>
      <p style={{ marginBottom: 12 }}>
        Use the controls below to upload new tracks, manage cached outputs, and
        kick off stem runs for the latest audio in storage.
      </p>
      <ul style={{ margin: 0, paddingLeft: 20 }}>
        <li>
          Upload an MP3 in the input panel to create a new MD5 folder and
          refresh the bucket list.
        </li>
        <li>
          Click an input folder to trigger a stem job, or click an output folder
          to delete its files.
        </li>
        <li>
          Select an MD5 folder to delete it after confirmation, or cancel to
          cache outputs locally and preview them in the player.
        </li>
        <li>
          Use “Clear cache” to remove locally stored outputs without touching
          GCS.
        </li>
      </ul>
    </section>
  );
}
