type UploadControlsProps = {
  isBusy: boolean;
  isDeleting: boolean;
  isClearingCache: boolean;
  isUploading: boolean;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onUpload: () => Promise<void> | void;
  onDeleteAll: () => Promise<void> | void;
  onClearCache: () => Promise<void> | void;
};

export default function UploadControls({
  isBusy,
  isDeleting,
  isClearingCache,
  isUploading,
  onFileChange,
  onUpload,
  onDeleteAll,
  onClearCache,
}: UploadControlsProps) {
  return (
    <div style={{ marginTop: "1rem" }}>
      <input type="file" onChange={onFileChange} disabled={isBusy} />
      <button
        onClick={onUpload}
        disabled={isBusy}
        style={{ marginLeft: "0.5rem" }}
      >
        {isUploading ? "Uploading..." : "Upload to GCS"}
      </button>
      <button
        onClick={onDeleteAll}
        disabled={isBusy}
        style={{ marginLeft: "0.5rem" }}
      >
        {isDeleting ? "Deleting..." : "Delete All GCS Files"}
      </button>
      <button
        onClick={onClearCache}
        disabled={isBusy}
        style={{ marginLeft: "0.5rem" }}
      >
        {isClearingCache ? "Clearing..." : "Clear IndexedDB Cache"}
      </button>
    </div>
  );
}
