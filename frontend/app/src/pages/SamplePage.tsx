import { useSampleController } from "../features/sample/hooks/useSampleController";
import Player from "../features/stems/player/Player";
import "./SamplePage.css";

export default function SamplePage() {
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
      className="sample-page"
      ref={pageRef}
      tabIndex={-1}
      aria-label="Sample page"
    >
      {activeRecord ? (
        <section className="sample-page__player">
          <Player record={activeRecord} onClose={clearActiveRecord} />
        </section>
      ) : null}

      <section className="sample-page__panel">
        <div className="sample-page__status-row">
          <div className="sample-page__status-area">
            {isLoading ? (
              <p className="sample-page__muted">Checking GCS for files...</p>
            ) : null}
            {!isLoading && inputOptions.length === 0 ? (
              <p className="sample-page__muted">
                No inputs were found in the bucket.
              </p>
            ) : null}
            {status ? <p>{status}</p> : null}
            {error ? <p className="sample-page__error">{error}</p> : null}
          </div>
          <div className="sample-page__actions">
            <button
              onClick={handleRefresh}
              disabled={isLoading || isFetchingSelection}
            >
              Refresh inputs
            </button>
          </div>
        </div>
        <div className="sample-page__control-group">
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
