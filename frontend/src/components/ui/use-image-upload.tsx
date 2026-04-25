import { useCallback, useEffect, useRef, useState } from "react";

interface UseImageUploadProps {
  onUpload?: (file: File, url: string) => void | Promise<void>;
}

export function useImageUpload({ onUpload }: UseImageUploadProps = {}) {
  const previewRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleThumbnailClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        if (previewRef.current) {
          URL.revokeObjectURL(previewRef.current);
        }
        setFile(file);
        setFileName(file.name);
        const url = URL.createObjectURL(file);
        setPreviewUrl(url);
        previewRef.current = url;
      }
    },
    [],
  );

  const handleConfirmUpload = useCallback(async () => {
    if (!file || !previewRef.current) return;
    await onUpload?.(file, previewRef.current);
  }, [file, onUpload]);

  const handleRemove = useCallback(() => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    setFileName(null);
    setFile(null);
    previewRef.current = null;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [previewUrl]);

  useEffect(() => {
    return () => {
      if (previewRef.current) {
        URL.revokeObjectURL(previewRef.current);
      }
    };
  }, []);

  return {
    file,
    previewUrl,
    fileName,
    fileInputRef,
    handleThumbnailClick,
    handleFileChange,
    handleConfirmUpload,
    handleRemove,
  };
}
