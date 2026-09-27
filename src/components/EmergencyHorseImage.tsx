type Props = {
  name: string;
  /** Tailwind size class for width/height, e.g. w-14 h-14 */
  sizeClass?: string;
  /** Photo URL once available; falls back to the "準備中" placeholder when absent. */
  imageUrl?: string | null;
};

export default function EmergencyHorseImage({
  name,
  sizeClass = "w-14 h-14",
  imageUrl,
}: Props) {
  return (
    <div className={`emergency-horse-thumb shrink-0 ${sizeClass}`}>
      <div
        className="absolute emergency-horse-border-spin"
        style={{
          top: "-50%",
          left: "-50%",
          width: "200%",
          height: "200%",
          background:
            "conic-gradient(from 0deg, #ec4899, #f472b6 14%, #ffffff 20%, #ffffff 26%, transparent 32%, transparent 68%, #ffffff 74%, #ffffff 80%, #f472b6 86%, #ec4899)",
        }}
        aria-hidden
      />
      <div className="emergency-horse-thumb__inner flex items-center justify-center bg-gray-200">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={name} className="w-full h-full object-cover" />
        ) : (
          <span
            aria-label={name}
            className="text-[10px] sm:text-xs font-bold text-gray-500 leading-tight text-center px-1"
          >
            準備中
          </span>
        )}
      </div>
    </div>
  );
}
