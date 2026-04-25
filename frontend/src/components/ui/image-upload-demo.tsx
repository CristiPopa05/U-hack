import { useCallback, useState } from "react";
import { FileJson2, ImagePlus, Loader2, Send, Trash2, Upload, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useImageUpload } from "@/components/ui/use-image-upload";

export function ImageUploadDemo() {
  const {
    file,
    previewUrl,
    fileName,
    fileInputRef,
    handleThumbnailClick,
    handleFileChange,
    handleConfirmUpload,
    handleRemove,
  } = useImageUpload({
    onUpload: async (selectedFile) => {
      const content = await selectedFile.text();
      JSON.parse(content);
      console.log("Confirmed statistics file:", selectedFile.name);
      toast({
        title: "Statistics queued",
        description: `${selectedFile.name} is ready for your upload pipeline.`,
      });
    },
  });

  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const file = e.dataTransfer.files?.[0];
      const isJsonFile =
        file && (file.type === "application/json" || file.name.toLowerCase().endsWith(".json"));
      if (isJsonFile) {
        const fakeEvent = {
          target: {
            files: [file],
          },
        } as React.ChangeEvent<HTMLInputElement>;
        handleFileChange(fakeEvent);
      }
    },
    [handleFileChange],
  );

  const confirmUpload = useCallback(async () => {
    if (!file) return;

    setIsSubmitting(true);
    try {
      await handleConfirmUpload();
      handleRemove();
    } catch {
      toast({
        variant: "destructive",
        title: "Invalid JSON file",
        description: "Please upload a valid JSON statistics file.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [file, handleConfirmUpload, handleRemove]);

  return (
    <div className="w-full space-y-6 rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="space-y-2">
        <h3 className="text-lg font-medium">Statistics Upload</h3>
        <p className="text-sm text-muted-foreground">Supported format: JSON</p>
      </div>

      <Input
        type="file"
        accept="application/json,.json"
        className="hidden"
        ref={fileInputRef}
        onChange={handleFileChange}
      />

      {!previewUrl ? (
        <div
          onClick={handleThumbnailClick}
          onDragOver={handleDragOver}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "flex h-64 cursor-pointer flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed border-muted-foreground/25 bg-muted/50 transition-colors hover:bg-muted",
            isDragging && "border-primary/50 bg-primary/5",
          )}
        >
          <div className="rounded-full bg-background p-3 shadow-sm">
            <ImagePlus className="h-6 w-6 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">Click to select JSON</p>
            <p className="text-xs text-muted-foreground">or drag and drop file here</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-background p-2 shadow-sm">
                <FileJson2 className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{fileName}</p>
                <p className="text-xs text-muted-foreground mt-1">JSON file selected. Confirm to send.</p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={handleThumbnailClick}>
              <Upload className="h-4 w-4 mr-2" />
              Replace
            </Button>
            <Button type="button" variant="destructive" onClick={handleRemove}>
              <Trash2 className="h-4 w-4 mr-2" />
              Remove
            </Button>
            <Button type="button" onClick={confirmUpload} disabled={isSubmitting || !previewUrl}>
              {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Confirm Upload
            </Button>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <X className="h-3.5 w-3.5" />
            Nothing is sent until you click Confirm Upload.
          </div>
        </div>
      )}
    </div>
  );
}
