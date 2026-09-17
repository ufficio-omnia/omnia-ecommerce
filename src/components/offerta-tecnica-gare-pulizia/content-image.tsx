import Image from "next/image";

export default function ContentImage({
  src,
  alt,
  caption,
}: {
  src: string;
  alt: string;
  caption: string;
}) {
  return (
    <figure className="my-8 overflow-hidden rounded-2xl border border-border bg-cream-soft">
      <div className="relative aspect-[1/1.414] w-full">
        <Image
          src={src}
          alt={alt}
          fill
          sizes="(min-width: 1024px) 640px, 90vw"
          className="object-contain"
        />
      </div>
      <figcaption className="border-t border-border px-4 py-2 text-center font-mono text-[11px] tracking-wide text-sage uppercase">
        {caption}
      </figcaption>
    </figure>
  );
}
