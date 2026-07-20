"use client";

import Image from "next/image";
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type WheelEvent,
} from "react";
import {
  Aperture,
  Camera,
  ChevronLeft,
  ChevronRight,
  Focus,
  ScanSearch,
  X,
} from "lucide-react";

import {
  DEFAULT_IMAGE_CAMERA_CONTROL,
  getImageCameraControlLabels,
  IMAGE_APERTURE_OPTIONS,
  IMAGE_CAMERA_OPTIONS,
  IMAGE_FOCAL_LENGTH_OPTIONS,
  IMAGE_LENS_OPTIONS,
  type ImageCameraControl,
} from "@/components/zenme/image-edit-options";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type PickerOption = {
  image?: string;
  label: string;
  value: string;
};

const APERTURE_IMAGE_OPTIONS = IMAGE_APERTURE_OPTIONS.map((option) => ({
  image:
    option === "ƒ/1.4"
      ? "/camera-control/f1_4-DoQLC9Jc.png"
      : option === "ƒ/4"
        ? "/camera-control/f4-Or-YmP2I.png"
        : "/camera-control/f11-Bu2Wl3ak.png",
  label: option,
  value: option,
}));

const CAMERA_CONTROL_IMAGE_SOURCES = [
  ...IMAGE_CAMERA_OPTIONS.map((option) => option.image),
  ...IMAGE_LENS_OPTIONS.map((option) => option.image),
  ...APERTURE_IMAGE_OPTIONS.map((option) => option.image),
  "/camera-control/camera-control-bg-BWXIpVpf.png",
];

let cameraControlImagesPreloaded = false;

export function ImageCameraControlPicker({
  onChange,
  onOpenChange,
  value,
}: {
  onChange: (value?: ImageCameraControl) => void;
  onOpenChange?: (open: boolean) => void;
  value?: ImageCameraControl;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ImageCameraControl>(
    value ?? DEFAULT_IMAGE_CAMERA_CONTROL,
  );
  const labels = value ? getImageCameraControlLabels(value) : undefined;

  useEffect(() => {
    if (cameraControlImagesPreloaded) return;
    cameraControlImagesPreloaded = true;

    for (const source of CAMERA_CONTROL_IMAGE_SOURCES) {
      const image = new window.Image();
      image.decoding = "async";
      image.src = source;
      void image.decode().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!open) setDraft(value ?? DEFAULT_IMAGE_CAMERA_CONTROL);
  }, [open, value]);

  function changeOpen(nextOpen: boolean) {
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }

  return (
    <DropdownMenu open={open} onOpenChange={changeOpen}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="摄影机控制"
          className={`flex h-[30px] min-w-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition ${
            value
              ? "border-zinc-300 bg-zinc-900 text-white hover:bg-zinc-800"
              : "border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100"
          }`}
          title={labels ? `${labels.camera} · ${labels.lens} · ${labels.focalLength} · ${labels.aperture}` : "添加摄影机与镜头参数"}
          type="button"
        >
          <Camera className="size-3.5 shrink-0" />
          <span className="max-w-28 truncate">
            {labels ? `${labels.camera} · ${labels.focalLength}` : "摄影机"}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="zenme-shadow-dropdown nodrag nowheel w-[584px] max-w-[calc(100vw-32px)] overflow-hidden rounded-xl border-zinc-200 bg-white p-0 text-zinc-950"
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        side="top"
        sideOffset={8}
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
          <div>
            <p className="text-sm font-semibold">摄影机控制</p>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              参数会作为摄影指导加入本次图片生成
            </p>
          </div>
          <div className="flex items-center gap-2">
            {value ? (
              <button
                className="flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
                onClick={() => {
                  onChange(undefined);
                  changeOpen(false);
                }}
                type="button"
              >
                <X className="size-3.5" />
                清除
              </button>
            ) : null}
            <button
              className="h-7 rounded-md bg-zinc-950 px-3 text-xs font-medium text-white transition hover:bg-zinc-800"
              onClick={() => {
                onChange(draft);
                changeOpen(false);
              }}
              type="button"
            >
              保存
            </button>
          </div>
        </div>

        <div className="grid grid-cols-4 divide-x divide-zinc-100 p-3">
          <CameraWheel
            icon={<Camera className="size-3.5" />}
            label="摄影机"
            onChange={(camera) =>
              setDraft((current) => ({
                ...current,
                camera: camera as ImageCameraControl["camera"],
              }))
            }
            options={IMAGE_CAMERA_OPTIONS}
            value={draft.camera}
          />
          <CameraWheel
            icon={<ScanSearch className="size-3.5" />}
            label="镜头"
            onChange={(lens) =>
              setDraft((current) => ({
                ...current,
                lens: lens as ImageCameraControl["lens"],
              }))
            }
            options={IMAGE_LENS_OPTIONS}
            value={draft.lens}
          />
          <CameraWheel
            icon={<Focus className="size-3.5" />}
            label="焦距"
            onChange={(focalLength) =>
              setDraft((current) => ({
                ...current,
                focalLength:
                  focalLength as ImageCameraControl["focalLength"],
              }))
            }
            options={IMAGE_FOCAL_LENGTH_OPTIONS.map((option) => ({
              label: option,
              value: option,
            }))}
            value={draft.focalLength}
          />
          <CameraWheel
            icon={<Aperture className="size-3.5" />}
            label="光圈"
            onChange={(aperture) =>
              setDraft((current) => ({
                ...current,
                aperture: aperture as ImageCameraControl["aperture"],
              }))
            }
            options={APERTURE_IMAGE_OPTIONS}
            value={draft.aperture}
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CameraWheel({
  icon,
  label,
  onChange,
  options,
  value,
}: {
  icon: ReactNode;
  label: string;
  onChange: (value: string) => void;
  options: readonly PickerOption[];
  value: string;
}) {
  const lastWheelAt = useRef(0);
  const [transition, setTransition] = useState<{
    direction: "next" | "previous";
    sequence: number;
  }>({ direction: "next", sequence: 0 });
  const currentIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const current = options[currentIndex] ?? options[0];
  const previous = options[(currentIndex - 1 + options.length) % options.length];
  const next = options[(currentIndex + 1) % options.length];

  function move(offset: number) {
    const index = (currentIndex + offset + options.length) % options.length;
    setTransition((currentTransition) => ({
      direction: offset > 0 ? "next" : "previous",
      sequence: currentTransition.sequence + 1,
    }));
    onChange(options[index]?.value ?? value);
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    const delta =
      Math.abs(event.deltaY) >= Math.abs(event.deltaX)
        ? event.deltaY
        : event.deltaX;
    if (!delta) return;

    event.preventDefault();
    event.stopPropagation();
    const now = Date.now();
    if (now - lastWheelAt.current < 100) return;
    lastWheelAt.current = now;
    move(delta > 0 ? 1 : -1);
  }

  return (
    <div
      className="group/wheel min-w-0 rounded-xl px-2 py-1 transition-colors hover:bg-zinc-50"
      onWheel={handleWheel}
      title={`悬停后滚动鼠标滚轮切换${label}`}
    >
      <div className="mb-2 flex items-center justify-center gap-1.5 text-[11px] font-medium text-zinc-500">
        {icon}
        {label}
      </div>
      <div className="flex items-center justify-center gap-1">
        <button
          aria-label={`上一个${label}`}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900"
          onClick={() => move(-1)}
          type="button"
        >
          <ChevronLeft className="size-3.5" />
        </button>
        <div className="relative h-[164px] min-w-0 flex-1 overflow-hidden rounded-2xl bg-zinc-100/80 ring-1 ring-inset ring-zinc-200 transition group-hover/wheel:ring-zinc-400">
          <div className="absolute inset-x-2 top-1/2 h-16 -translate-y-1/2 rounded-xl bg-white shadow-sm ring-1 ring-zinc-200/80" />
          <div
            className="pointer-events-none absolute inset-x-2 top-1/2 h-16 -translate-y-1/2 rounded-xl bg-cover bg-center opacity-70"
            style={{ backgroundImage: "url('/camera-control/camera-control-bg-BWXIpVpf.png')" }}
          />
          <div
            className="zenme-camera-wheel-transition relative grid h-full grid-rows-[48px_68px_48px] items-center text-center"
            data-direction={transition.direction}
            key={`${current?.value}-${transition.sequence}`}
          >
            <WheelItemPreview compact option={previous} />
            <div className="flex min-w-0 flex-col items-center justify-center px-1">
              <WheelItemPreview option={current} />
            </div>
            <WheelItemPreview compact option={next} />
          </div>
        </div>
        <button
          aria-label={`下一个${label}`}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-900"
          onClick={() => move(1)}
          type="button"
        >
          <ChevronRight className="size-3.5" />
        </button>
      </div>
      <p className="mt-2 truncate text-center text-[11px] font-semibold text-zinc-800" title={current?.label}>
        <span
          className="zenme-camera-wheel-label inline-block max-w-full truncate"
          data-direction={transition.direction}
          key={`${current?.value}-label-${transition.sequence}`}
        >
          {current?.label}
        </span>
      </p>
    </div>
  );
}

function WheelItemPreview({
  compact = false,
  option,
}: {
  compact?: boolean;
  option?: PickerOption;
}) {
  if (!option) return null;

  if (!option.image) {
    return (
      <span
        className={
          compact
            ? "truncate px-1 text-[10px] font-semibold text-zinc-400"
            : "text-lg font-semibold tracking-tight text-zinc-950"
        }
      >
        {option.label}
      </span>
    );
  }

  return (
    <div className={compact ? "relative h-9 w-12 opacity-45" : "relative h-14 w-16"}>
      <Image
        alt={option.label}
        className="object-contain"
        fill
        sizes={compact ? "48px" : "64px"}
        src={option.image}
        unoptimized
      />
    </div>
  );
}
