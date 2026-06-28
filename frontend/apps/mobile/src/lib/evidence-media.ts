import { Alert, Linking } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import {
  confirmEvidenceFileUpload,
  requestEvidenceFileUpload,
} from "apis";

export type LocalEvidenceAsset = {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
};

type PermissionResponse = Awaited<ReturnType<typeof ImagePicker.getCameraPermissionsAsync>>;

function inferMimeType(asset: LocalEvidenceAsset): string {
  if (asset.mimeType) {
    return asset.mimeType;
  }

  const normalizedUri = asset.uri.toLowerCase();
  if (normalizedUri.endsWith(".png")) {
    return "image/png";
  }
  if (normalizedUri.endsWith(".heic") || normalizedUri.endsWith(".heif")) {
    return "image/heic";
  }

  return "image/jpeg";
}

function inferFilename(asset: LocalEvidenceAsset, mimeType: string): string {
  if (asset.fileName) {
    return asset.fileName;
  }

  const extension = mimeType === "image/png"
    ? "png"
    : mimeType === "image/heic"
      ? "heic"
      : "jpg";

  return `evidence-${Date.now()}.${extension}`;
}

async function resolveFileSize(asset: LocalEvidenceAsset): Promise<number> {
  if (typeof asset.fileSize === "number" && asset.fileSize > 0) {
    return asset.fileSize;
  }

  const info = await FileSystem.getInfoAsync(asset.uri);
  if (!info.exists || typeof info.size !== "number" || info.size <= 0) {
    throw new Error("Could not read the selected file.");
  }

  return info.size;
}

function showPermissionRecoveryAlert(title: string, message: string, canAskAgain: boolean) {
  if (canAskAgain) {
    Alert.alert(title, message);
    return;
  }

  Alert.alert(title, `${message} Please enable it in Settings.`, [
    { text: "Cancel", style: "cancel" },
    {
      text: "Open Settings",
      onPress: () => {
        void Linking.openSettings();
      },
    },
  ]);
}

async function ensureImagePickerPermission(params: {
  getPermission: () => Promise<PermissionResponse>;
  requestPermission: () => Promise<PermissionResponse>;
  title: string;
  message: string;
}): Promise<boolean> {
  const currentPermission = await params.getPermission();
  if (currentPermission.granted) {
    return true;
  }

  if (!currentPermission.canAskAgain) {
    showPermissionRecoveryAlert(params.title, params.message, false);
    return false;
  }

  const requestedPermission = await params.requestPermission();
  if (requestedPermission.granted) {
    return true;
  }

  showPermissionRecoveryAlert(
    params.title,
    params.message,
    requestedPermission.canAskAgain,
  );
  return false;
}

export async function ensureEvidenceCameraPermission(): Promise<boolean> {
  return ensureImagePickerPermission({
    getPermission: () => ImagePicker.getCameraPermissionsAsync(),
    requestPermission: () => ImagePicker.requestCameraPermissionsAsync(),
    title: "Permission Required",
    message: "Camera access is needed to capture fresh proof.",
  });
}

function mapPickedAsset(result: ImagePicker.ImagePickerResult): LocalEvidenceAsset | null {
  return !result.canceled && result.assets[0]
    ? {
        uri: result.assets[0].uri,
        fileName: result.assets[0].fileName,
        mimeType: result.assets[0].mimeType,
        fileSize: result.assets[0].fileSize,
      }
    : null;
}

async function launchEvidenceCamera(): Promise<LocalEvidenceAsset | null> {
  const hasCameraPermission = await ensureEvidenceCameraPermission();
  if (!hasCameraPermission) {
    return null;
  }

  try {
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.7,
      allowsEditing: false,
    });

    return mapPickedAsset(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Camera could not be opened.";
    Alert.alert("Camera unavailable", message);
    return null;
  }
}

export async function pickEvidencePhoto(): Promise<LocalEvidenceAsset | null> {
  return launchEvidenceCamera();
}

export async function uploadEvidenceAsset(params: {
  taskId: string;
  evidenceRequirementId: string;
  asset: LocalEvidenceAsset;
}): Promise<string> {
  const mimeType = inferMimeType(params.asset);
  const fileName = inferFilename(params.asset, mimeType);
  const fileSize = await resolveFileSize(params.asset);

  const uploadRequest = await requestEvidenceFileUpload(
    params.taskId,
    params.evidenceRequirementId,
    fileName,
    mimeType,
    fileSize,
  );

  const uploadResult = await FileSystem.uploadAsync(uploadRequest.uploadUrl, params.asset.uri, {
    httpMethod: "PUT",
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      "Content-Type": mimeType,
    },
  });

  if (uploadResult.status < 200 || uploadResult.status >= 300) {
    throw new Error("Upload failed before confirmation.");
  }

  return confirmEvidenceFileUpload(uploadRequest.fileId, params.taskId);
}