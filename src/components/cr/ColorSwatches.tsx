import { cn } from "~/lib/utils";

export type ShopColor = { key: string; name: string; hex: string };

// The shirt colors a work is offered in. Picking one repaints the art square above.
export function ColorSwatches({
  colors,
  value,
  onChange,
}: {
  colors: Array<ShopColor>;
  value: string;
  onChange: (key: string) => void;
}) {
  const current = colors.find((color) => color.key === value) ?? colors[0];
  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-wider">
        Color <span className="ml-1 font-semibold normal-case tracking-normal text-neutral-600">{current?.name}</span>
      </p>
      <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Color">
        {colors.map((color) => {
          const on = color.key === current?.key;
          return (
            <button
              key={color.key}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={color.name}
              title={color.name}
              onClick={() => onChange(color.key)}
              className={cn(
                "h-11 w-11 rounded-full border-2 transition-transform active:scale-95",
                on ? "border-black ring-2 ring-black ring-offset-2" : "border-black/20 hover:border-black",
              )}
              style={{ background: color.hex }}
            />
          );
        })}
      </div>
    </div>
  );
}
