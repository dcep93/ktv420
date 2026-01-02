import sha from "./KTV420/sha.json";
import "./RootShaPage.css";

export default function RootShaPage() {
  return (
    <main className="root-sha-page">
      <h1>Build SHA</h1>
      <p>This deployment was built from the following commit metadata:</p>
      <pre>{JSON.stringify(sha, null, 2)}</pre>
    </main>
  );
}
