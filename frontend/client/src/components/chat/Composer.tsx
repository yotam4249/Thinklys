import { useRef, useState } from "react";
import sendIcon from "../../assets/sendButton.svg";
import { presignUpload, uploadViaPresignedPut } from "../../services/s3.service";

type ImagePreview = {
  file: File;
  preview: string;
  key: string; // S3 key after upload
  uploading: boolean;
  error?: string;
};

export function Composer({
  disabled,
  onSend,
  placeholder = "Type your message...",
}: {
  disabled?: boolean;
  onSend: (text: string, imageUrls?: string[]) => void;
  placeholder?: string;
}) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [images, setImages] = useState<ImagePreview[]>([]);

  const autogrow = () => {
    const ta = areaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(160, ta.scrollHeight) + "px";
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    autogrow();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      alert("Please select image files only");
      return;
    }

    // Limit to 5 images at once
    const toAdd = imageFiles.slice(0, 5 - images.length);
    if (toAdd.length === 0) {
      alert("Maximum 5 images allowed");
      return;
    }

    const newImages: ImagePreview[] = toAdd.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      key: "",
      uploading: false,
    }));

    setImages((prev) => [...prev, ...newImages]);

    // Upload images to S3
    for (let i = 0; i < newImages.length; i++) {
      const img = newImages[i];
      const idx = images.length + i;

      setImages((prev) => {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], uploading: true };
        return updated;
      });

      try {
        const { url, key } = await presignUpload(img.file.type, {
          prefix: "chat/images",
        });
        await uploadViaPresignedPut(url, img.file, img.file.type);

        setImages((prev) => {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], key, uploading: false };
          return updated;
        });
      } catch (err) {
        console.error("Upload error:", err);
        setImages((prev) => {
          const updated = [...prev];
          updated[idx] = {
            ...updated[idx],
            uploading: false,
            error: "Upload failed",
          };
          return updated;
        });
      }
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeImage = (index: number) => {
    setImages((prev) => {
      const updated = [...prev];
      URL.revokeObjectURL(updated[index].preview);
      updated.splice(index, 1);
      return updated;
    });
  };

  const send = async () => {
    const text = value.trim();
    const imageKeys = images
      .filter((img) => img.key && !img.uploading && !img.error)
      .map((img) => img.key);

    if (!text && imageKeys.length === 0) return;
    if (disabled) return;

    // Don't send if images are still uploading
    const stillUploading = images.some((img) => img.uploading);
    if (stillUploading) {
      alert("Please wait for images to finish uploading");
      return;
    }

    onSend(text, imageKeys.length > 0 ? imageKeys : undefined);
    setValue("");
    setImages((prev) => {
      prev.forEach((img) => URL.revokeObjectURL(img.preview));
      return [];
    });
    const ta = areaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.focus();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // Enable only when there's non-whitespace text or images, and not externally disabled
  const hasContent = value.trim().length > 0 || images.some((img) => img.key && !img.uploading && !img.error);
  const canSend = !disabled && hasContent && !images.some((img) => img.uploading);
  const charCount = value.length;
  const charLimit = 5000; // Reasonable message limit

  return (
    <div className="composer" role="region" aria-label="Message composer">
      {images.length > 0 && (
        <div className="composer-images">
          {images.map((img, idx) => (
            <div key={idx} className="composer-image-preview">
              <img src={img.preview} alt={`Preview ${idx + 1}`} />
              <button
                type="button"
                className="composer-image-remove"
                onClick={() => removeImage(idx)}
                aria-label="Remove image"
              >
                ×
              </button>
              {img.uploading && (
                <div className="composer-image-uploading">
                  <div className="composer-image-spinner"></div>
                </div>
              )}
              {img.error && (
                <div className="composer-image-error" title={img.error}>
                  !
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="composer-row">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileSelect}
          className="sr-only"
          id="file-input"
          aria-label="Upload images"
        />
        <label htmlFor="file-input" className="file-input-label">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="17 8 12 3 7 8"></polyline>
            <line x1="12" y1="3" x2="12" y2="15"></line>
          </svg>
        </label>
        <div className="input-wrap">
          <label htmlFor="message-input" className="sr-only">
            Type your message
          </label>
          <textarea
            id="message-input"
            ref={areaRef}
            className="textarea"
            placeholder={placeholder}
            value={value}
            onChange={handleChange}
            onKeyDown={onKeyDown}
            rows={1}
            dir="auto"
            aria-label="Message input"
            aria-describedby="message-hint"
            maxLength={charLimit}
            disabled={disabled}
          />
          {charCount > charLimit * 0.8 && (
            <span 
              id="message-hint" 
              className="char-count"
              aria-live="polite"
            >
              {charCount} / {charLimit}
            </span>
          )}
        </div>
        <button
          className="send-btn"
          onClick={send}
          disabled={!canSend}
          aria-disabled={!canSend}
          aria-label={canSend ? "Send message" : "Type a message or add images to enable sending"}
          title={canSend ? "Send message (Enter)" : "Type a message or add images to enable"}
          type="button"
        >
          <img
            src={sendIcon}
            alt=""
            aria-hidden="true"
            style={{
              width: 20,
              height: 20,
              marginRight: 6,
              filter: !canSend ? "grayscale(0.6) opacity(0.5)" : "none",
              transition: "filter 0.2s ease",
            }}
          />
          <span>Send</span>
        </button>
      </div>
    </div>
  );
}
