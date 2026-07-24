"use client";

import { useEffect, useRef, useState } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { Clock3, FileText, Plus, Search, Tag, X } from "lucide-react";

import type {
  CanvasNodeData,
  CanvasTagColor,
} from "@/components/zenme/node-types";
import {
  NodeActionHandle,
  NodeContextHandle,
  NodeContextTargetHandle,
  NodeEdgeSourceHandle,
  NodeTargetHandle,
} from "@/components/zenme/node-ui";
import { TextNodeComposer } from "@/components/zenme/nodes/text-node-composer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const TEXT_SYNC_DELAY_MS = 500;
const MAX_TAG_COUNT = 12;
const MAX_TAG_LENGTH = 24;

export function ManagedTextNode({ data, id, selected }: NodeProps) {
  const nodeData = data as CanvasNodeData;
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tagInputRef = useRef<HTMLInputElement | null>(null);
  const [content, setContent] = useState(nodeData.plainText ?? "");
  const [draftName, setDraftName] = useState(nodeData.name ?? "");
  const [draftTag, setDraftTag] = useState("");
  const [isEditingContent, setIsEditingContent] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [colorEditingTag, setColorEditingTag] = useState<string | null>(null);
  const tags = nodeData.tags ?? [];
  const projectTags = nodeData.projectTags ?? [];
  const matchingProjectTags = projectTags.filter((tag) =>
    tag.toLocaleLowerCase().includes(draftTag.trim().toLocaleLowerCase()),
  );
  const canCreateTag = Boolean(
    draftTag.trim() &&
    !projectTags.some(
      (tag) => tag.toLocaleLowerCase() === draftTag.trim().toLocaleLowerCase(),
    ),
  );
  const isEditingMetadata = isEditingName || isAddingTag;

  useEffect(() => {
    if (!isEditingContent) {
      setContent(nodeData.plainText ?? "");
    }
  }, [isEditingContent, nodeData.plainText]);

  useEffect(() => {
    if (!isEditingName) {
      setDraftName(nodeData.name ?? "");
    }
  }, [isEditingName, nodeData.name]);

  useEffect(() => {
    if (isAddingTag) {
      tagInputRef.current?.focus();
    }
  }, [isAddingTag]);

  useEffect(
    () => () => {
      if (syncTimer.current) {
        clearTimeout(syncTimer.current);
      }
    },
    [],
  );

  function scheduleContentSync(nextContent: string) {
    if (syncTimer.current) {
      clearTimeout(syncTimer.current);
    }
    syncTimer.current = setTimeout(() => {
      syncTimer.current = null;
      nodeData.onUpdateTextNode?.(id, {
        plainText: nextContent,
        richTextHtml: "",
      });
    }, TEXT_SYNC_DELAY_MS);
  }

  function flushContent() {
    if (syncTimer.current) {
      clearTimeout(syncTimer.current);
      syncTimer.current = null;
    }
    nodeData.onUpdateTextNode?.(id, {
      plainText: content,
      richTextHtml: "",
    });
  }

  function commitName() {
    const nextName = draftName.trim();
    setIsEditingName(false);
    if (nextName !== (nodeData.name ?? "")) {
      nodeData.onUpdateTextNode?.(id, { name: nextName });
    }
  }

  function selectTag(inputTag: string) {
    const nextTag = inputTag.trim().slice(0, MAX_TAG_LENGTH);
    setDraftTag("");
    setIsAddingTag(false);
    if (
      !nextTag ||
      tags.length >= MAX_TAG_COUNT ||
      tags.some(
        (tag) => tag.toLocaleLowerCase() === nextTag.toLocaleLowerCase(),
      )
    ) {
      return;
    }
    nodeData.onUpdateTextNode?.(id, { tags: [...tags, nextTag] });
  }

  function removeTag(tagToRemove: string) {
    nodeData.onUpdateTextNode?.(id, {
      tags: tags.filter((tag) => tag !== tagToRemove),
    });
  }

  function deleteProjectTag(tag: string) {
    setColorEditingTag(null);
    nodeData.onUpdateProjectTag?.({ type: "delete", tag });
  }

  function updateProjectTagColor(tag: string, color: CanvasTagColor) {
    setColorEditingTag(null);
    nodeData.onUpdateProjectTag?.({ type: "color", tag, color });
  }

  function renderTagColorPicker(tag: string, tagColor: CanvasTagColor) {
    return (
      <DropdownMenuContent
        align="start"
        className="nodrag nowheel min-w-0 rounded-lg p-2"
        onCloseAutoFocus={(event) => event.preventDefault()}
        side="right"
        sideOffset={6}
      >
        <div className="grid grid-cols-3 gap-1">
          {TAG_COLOR_OPTIONS.map((option) => (
            <button
              aria-label={`将标签 ${tag} 设为${option.label}`}
              className={`flex size-8 items-center justify-center rounded-md outline-none transition-colors hover:bg-zinc-100 focus-visible:bg-zinc-100 ${
                tagColor === option.value ? "bg-zinc-100" : ""
              }`}
              key={option.value}
              onClick={() => updateProjectTagColor(tag, option.value)}
              title={option.label}
              type="button"
            >
              <span
                className={`size-4 rounded-sm border ${tagSwatchClassName(option.value)}`}
              />
            </button>
          ))}
        </div>
      </DropdownMenuContent>
    );
  }

  return (
    <div
      className={`zenme-managed-text-node group relative h-full w-full ${
        isEditingMetadata ? "zenme-node-renaming" : ""
      }`}
    >
      <NodeTargetHandle
        revealOnHover={false}
        visible={Boolean(nodeData.hasIncomingEdge)}
      />
      <NodeEdgeSourceHandle visible={Boolean(nodeData.hasOutgoingEdge)} />
      <NodeContextHandle selected={Boolean(selected)} />
      <NodeContextTargetHandle />

      <div className="zenme-node-title-bar absolute -top-8 left-1 flex h-5 items-center gap-2 text-xs font-medium text-zinc-500">
        <span className="zenme-node-title-icon-hitbox">
          <FileText className="size-4" />
        </span>
        <span>强管理节点</span>
      </div>

      <div
        className={`zenme-shadow-node flex h-full min-h-[260px] w-full flex-col overflow-hidden rounded-xl border bg-white text-zinc-950 ${
          selected ? "border-zinc-900" : "border-zinc-200"
        }`}
      >
        <header className="m-3 mb-0 shrink-0 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3">
          <div className="flex min-w-0 items-center justify-between gap-4">
            <input
              aria-label="节点名称"
              className="zenme-managed-name-input nodrag nowheel min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-base font-semibold text-zinc-950 outline-none transition-colors placeholder:text-zinc-400 hover:border-zinc-300 focus:border-zinc-500"
              onBlur={commitName}
              onChange={(event) => setDraftName(event.target.value)}
              onFocus={() => setIsEditingName(true)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setDraftName(nodeData.name ?? "");
                  event.currentTarget.blur();
                }
              }}
              placeholder="未命名节点"
              value={draftName}
            />
            <span className="flex shrink-0 items-center gap-1 text-xs text-zinc-400">
              <Clock3 className="size-3.5" />
              {formatCreatedAt(nodeData.createdAt)}
            </span>
          </div>

          <div className="mt-3 flex min-h-7 flex-wrap items-center gap-1.5">
            <Tag className="mr-0.5 size-3.5 text-zinc-400" />
            {tags.map((tag) => {
              const tagColor = getTagColor(
                tag,
                nodeData.projectTagColors?.[tag],
              );
              return (
                <DropdownMenu
                  key={tag}
                  onOpenChange={(open) => setColorEditingTag(open ? tag : null)}
                  open={colorEditingTag === tag}
                >
                  <span
                    className={`nodrag group/tag inline-flex h-6 max-w-40 items-center gap-1 rounded-md px-2 text-xs ${tagColorClassName(tag, tagColor)}`}
                  >
                    <DropdownMenuTrigger asChild>
                      <button
                        className="min-w-0 truncate rounded outline-none hover:opacity-75 focus-visible:ring-2 focus-visible:ring-zinc-400"
                        title={`修改标签 ${tag} 的颜色`}
                        type="button"
                      >
                        {tag}
                      </button>
                    </DropdownMenuTrigger>
                    <button
                      aria-label={`删除标签 ${tag}`}
                      className="hidden shrink-0 text-zinc-400 hover:text-zinc-700 group-hover/tag:block"
                      onClick={() => removeTag(tag)}
                      type="button"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                  {renderTagColorPicker(tag, tagColor)}
                </DropdownMenu>
              );
            })}
            {tags.length < MAX_TAG_COUNT ? (
              <DropdownMenu
                onOpenChange={(open) => {
                  setIsAddingTag(open);
                  if (!open) {
                    setDraftTag("");
                    setColorEditingTag(null);
                  }
                }}
                open={isAddingTag}
              >
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label="添加标签"
                    className="nodrag flex size-6 items-center justify-center rounded-md border border-dashed border-zinc-300 text-zinc-400 hover:border-zinc-400 hover:text-zinc-700"
                    title="添加标签"
                    type="button"
                  >
                    <Plus className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="nodrag nowheel w-56 rounded-lg p-2"
                  onCloseAutoFocus={(event) => event.preventDefault()}
                  sideOffset={6}
                >
                  <div className="flex h-9 items-center gap-2 rounded-md border border-zinc-200 px-2 focus-within:border-zinc-400">
                    <Search className="size-4 shrink-0 text-zinc-400" />
                    <input
                      aria-label="搜索或创建标签"
                      className="zenme-managed-tag-input min-w-0 flex-1 bg-transparent text-sm text-zinc-800 outline-none placeholder:text-zinc-400"
                      maxLength={MAX_TAG_LENGTH}
                      onChange={(event) => setDraftTag(event.target.value)}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Enter" && canCreateTag) {
                          event.preventDefault();
                          selectTag(draftTag);
                        }
                      }}
                      placeholder="搜索或创建标签..."
                      ref={tagInputRef}
                      value={draftTag}
                    />
                  </div>
                  <p className="px-2 pb-1 pt-3 text-[11px] font-medium text-zinc-400">
                    选择标签或创建新标签
                  </p>
                  <div className="max-h-48 overflow-y-auto">
                    {matchingProjectTags.map((tag) => {
                      const selectedTag = tags.includes(tag);
                      const tagColor = getTagColor(
                        tag,
                        nodeData.projectTagColors?.[tag],
                      );
                      return (
                        <div className="rounded-md" key={tag}>
                          <div className="flex items-center gap-1 px-1 py-1">
                            <button
                              className="flex min-w-0 flex-1 items-center rounded px-1 py-1 text-left hover:bg-zinc-100"
                              onClick={() => {
                                if (!selectedTag) selectTag(tag);
                              }}
                              type="button"
                            >
                              <span
                                className={`max-w-40 truncate rounded px-1.5 py-0.5 text-xs ${tagColorClassName(tag, tagColor)}`}
                              >
                                {tag}
                              </span>
                            </button>
                            <DropdownMenu
                              onOpenChange={(open) =>
                                setColorEditingTag(open ? tag : null)
                              }
                              open={colorEditingTag === tag}
                            >
                              <DropdownMenuTrigger asChild>
                                <button
                                  aria-label={`修改标签 ${tag} 的颜色`}
                                  className="flex size-7 shrink-0 items-center justify-center rounded outline-none hover:opacity-75 focus-visible:ring-2 focus-visible:ring-zinc-400"
                                  title="修改颜色"
                                  type="button"
                                >
                                  <span
                                    className={`size-3.5 rounded-sm border ${tagSwatchClassName(tagColor)}`}
                                  />
                                </button>
                              </DropdownMenuTrigger>
                              {renderTagColorPicker(tag, tagColor)}
                            </DropdownMenu>
                            <button
                              aria-label={`删除项目标签 ${tag}`}
                              className="flex size-7 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                              onClick={() => deleteProjectTag(tag)}
                              title="删除标签"
                              type="button"
                            >
                              <X className="size-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    {canCreateTag ? (
                      <DropdownMenuItem
                        className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm"
                        onSelect={() => selectTag(draftTag)}
                      >
                        <Plus className="size-4 text-zinc-400" />
                        创建“
                        <span className="max-w-36 truncate">
                          {draftTag.trim()}
                        </span>
                        ”
                      </DropdownMenuItem>
                    ) : null}
                    {!matchingProjectTags.length && !canCreateTag ? (
                      <p className="px-2 py-3 text-sm text-zinc-400">
                        暂无可选标签
                      </p>
                    ) : null}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </header>

        <textarea
          aria-label="强管理节点内容"
          className="zenme-managed-text-editor nodrag nowheel min-h-0 flex-1 resize-none overflow-auto bg-transparent px-5 py-4 text-base leading-7 text-zinc-800 outline-none placeholder:text-zinc-400"
          onBlur={() => {
            setIsEditingContent(false);
            flushContent();
          }}
          onChange={(event) => {
            const nextContent = event.target.value;
            setContent(nextContent);
            scheduleContentSync(nextContent);
          }}
          onFocus={() => setIsEditingContent(true)}
          placeholder="记录内容、想法或资料..."
          value={content}
        />
      </div>

      {selected && !nodeData.isMultiSelection ? (
        <TextNodeComposer nodeData={nodeData} nodeId={id} />
      ) : null}
      <NodeResizer
        color="#a1a1aa"
        handleClassName="zenme-text-resize-handle"
        isVisible={Boolean(selected || isEditingContent)}
        lineClassName="zenme-text-resize-line"
        minHeight={260}
        minWidth={360}
      />
      <NodeActionHandle selected={Boolean(selected)} />
    </div>
  );
}

const TAG_COLOR_OPTIONS: Array<{ label: string; value: CanvasTagColor }> = [
  { label: "灰色", value: "gray" },
  { label: "棕色", value: "brown" },
  { label: "橙色", value: "orange" },
  { label: "黄色", value: "yellow" },
  { label: "绿色", value: "green" },
  { label: "蓝色", value: "blue" },
  { label: "紫色", value: "purple" },
  { label: "粉色", value: "pink" },
  { label: "红色", value: "red" },
];

const TAG_COLOR_CLASS_NAMES: Record<CanvasTagColor, string> = {
  gray: "bg-zinc-100 text-zinc-600",
  brown: "bg-stone-200 text-stone-700",
  orange: "bg-orange-100 text-orange-700",
  yellow: "bg-amber-100 text-amber-700",
  green: "bg-emerald-100 text-emerald-700",
  blue: "bg-sky-100 text-sky-700",
  purple: "bg-violet-100 text-violet-700",
  pink: "bg-pink-100 text-pink-700",
  red: "bg-rose-100 text-rose-700",
};

const TAG_SWATCH_CLASS_NAMES: Record<CanvasTagColor, string> = {
  gray: "border-zinc-300 bg-zinc-200",
  brown: "border-stone-300 bg-stone-300",
  orange: "border-orange-300 bg-orange-200",
  yellow: "border-amber-300 bg-amber-200",
  green: "border-emerald-300 bg-emerald-200",
  blue: "border-sky-300 bg-sky-200",
  purple: "border-violet-300 bg-violet-200",
  pink: "border-pink-300 bg-pink-200",
  red: "border-rose-300 bg-rose-200",
};

function getTagColor(tag: string, savedColor?: CanvasTagColor): CanvasTagColor {
  if (savedColor) return savedColor;
  let hash = 0;
  for (const character of tag) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return TAG_COLOR_OPTIONS[hash % TAG_COLOR_OPTIONS.length].value;
}

function tagColorClassName(tag: string, savedColor?: CanvasTagColor) {
  return TAG_COLOR_CLASS_NAMES[getTagColor(tag, savedColor)];
}

function tagSwatchClassName(color: CanvasTagColor) {
  return TAG_SWATCH_CLASS_NAMES[color];
}

function formatCreatedAt(value?: string) {
  if (!value) {
    return "时间未知";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "时间未知";
  }
  const parts = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}
