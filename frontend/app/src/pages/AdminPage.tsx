import AdminGuide from "../features/admin/components/AdminGuide";
import ObjectTreeView from "../features/admin/components/ObjectTreeView";
import StemStatusPanel from "../features/admin/components/StemStatusPanel";
import UploadControls from "../features/admin/components/UploadControls";
import { useAdminController } from "../features/admin/hooks/useAdminController";
import Player from "../features/stems/player/Player";

export default function AdminPage() {
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
