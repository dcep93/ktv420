import Player from "../../stems/player/Player";
import { useAdminController } from "../hooks/useAdminController";
import AdminGuide from "./AdminGuide";
import ObjectTreeView from "./ObjectTreeView";
import StemStatusPanel from "./StemStatusPanel";
import UploadControls from "./UploadControls";

export default function AdminWorkspace() {
  const admin = useAdminController();

  return (
    <div>
      <StemStatusPanel
        rootResponse={admin.rootResponse}
        onFetchRootResponse={() => void admin.fetchRootResponse()}
      />
      <AdminGuide />
      <ObjectTreeView
        isBusy={admin.isBusy}
        isListing={admin.isListing}
        listError={admin.listError}
        objectTree={admin.objectTree}
        totalObjects={admin.totalObjects}
        onRefresh={admin.refreshObjectList}
        onFolderClick={admin.handleFolderClick}
        isFolderClickable={admin.isFolderClickable}
        onFileClick={admin.handleFileClick}
      />
      <UploadControls
        isBusy={admin.isBusy}
        isDeleting={admin.isDeleting}
        isClearingCache={admin.isClearingCache}
        isUploading={admin.isUploading}
        onFileChange={admin.handleFileChange}
        onUpload={admin.handleUpload}
        onDeleteAll={admin.handleDeleteAll}
        onClearCache={admin.handleClearCache}
      />
      {admin.activeRecord ? (
        <Player record={admin.activeRecord} onClose={admin.closePlayer} />
      ) : null}
    </div>
  );
}
