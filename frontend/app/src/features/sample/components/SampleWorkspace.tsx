import Player from "../../stems/player/Player";
import { useSampleController } from "../hooks/useSampleController";
import "./SampleWorkspace.css";

export default function SampleWorkspace() {
  const {
    activeRecord,
    clearActiveRecord,
    error,
    handleRefresh,
    handleSelection,
    inputOptions,
    isFetchingSelection,
    isLoading,
    pageRef,
    selectedInput,
    status,
  } = useSampleController();

  return (
    <main
      className="sample-workspace"
      ref={pageRef}
      tabIndex={-1}
      aria-label="Sample page"
    >
      {activeRecord ? (
        <section className="sample-workspace__player">
          <Player record={activeRecord} onClose={clearActiveRecord} />
        </section>
      ) : null}

      <section className="sample-workspace__panel">
        <div className="sample-workspace__status-row">
          <div className="sample-workspace__status-area">
            {isLoading ? (
              <p className="sample-workspace__muted">
                Checking GCS for files...
              </p>
            ) : null}
            {!isLoading && inputOptions.length === 0 ? (
              <p className="sample-workspace__muted">
                No inputs were found in the bucket.
              </p>
            ) : null}
            {status ? <p>{status}</p> : null}
            {error ? <p className="sample-workspace__error">{error}</p> : null}
          </div>
          <div className="sample-workspace__actions">
            <button
              onClick={handleRefresh}
              disabled={isLoading || isFetchingSelection}
            >
              Refresh inputs
            </button>
          </div>
        </div>
        <div className="sample-workspace__control-group">
          <label htmlFor="input-selector">Choose an input file</label>
          <select
            id="input-selector"
            value={selectedInput}
            onChange={(event) => void handleSelection(event.target.value)}
            disabled={
              isLoading || isFetchingSelection || inputOptions.length === 0
            }
          >
            <option value="">Select an input...</option>
            {inputOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </section>
    </main>
  );
}
