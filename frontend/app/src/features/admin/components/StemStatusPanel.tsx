import sha from "../../stems/metadata/sha.json";

type StemStatusPanelProps = {
  rootResponse: unknown | null;
  onFetchRootResponse: () => void;
};

export default function StemStatusPanel({
  rootResponse,
  onFetchRootResponse,
}: StemStatusPanelProps) {
  const rootResponseText =
    rootResponse === null ? null : JSON.stringify(rootResponse, null, 2);

  return (
    <>
      <pre onClick={onFetchRootResponse} style={{ cursor: "pointer" }}>
        {JSON.stringify(sha, null, 2)}
      </pre>
      <pre>{rootResponseText}</pre>
    </>
  );
}
