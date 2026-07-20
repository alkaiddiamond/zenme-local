"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CirclePause,
  Clock3,
  ListTree,
  ListTodo,
  Pause,
  Play,
  Plus,
  Search,
  Tag,
  X,
} from "lucide-react";

import {
  normalizeTaskComplexity,
  normalizeTaskPriority,
  normalizeTaskStatus,
  normalizeTaskUrgency,
} from "@/components/zenme/node-types";
import type {
  CanvasNodeData,
  CanvasTagColor,
  TaskComplexity,
  TaskPriority,
  TaskParentOption,
  TaskStatus,
  TaskUrgency,
} from "@/components/zenme/node-types";
import {
  NodeActionHandle,
  NodeContextHandle,
  NodeContextTargetHandle,
  NodeEdgeSourceHandle,
  STANDARD_NODE_TARGET_HANDLE_ID,
  NodeTargetHandle,
} from "@/components/zenme/node-ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const MAX_TAG_COUNT = 12;
const MAX_TAG_LENGTH = 24;

export function TaskNode({ data, id, selected }: NodeProps) {
  const nodeData = data as CanvasNodeData;
  const childrenContentRef = useRef<HTMLElement | null>(null);
  const childrenPanelRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const tagInputRef = useRef<HTMLInputElement | null>(null);
  const [draftName, setDraftName] = useState(nodeData.name ?? "");
  const [draftTag, setDraftTag] = useState("");
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [colorEditingTag, setColorEditingTag] = useState<string | null>(null);
  const [activeOptionMenu, setActiveOptionMenu] = useState<string | null>(null);
  const tags = nodeData.tags ?? [];
  const projectTags = nodeData.projectTags ?? [];
  const children = nodeData.taskChildren ?? [];
  const parentOptions = nodeData.taskParentOptions ?? [];
  const completedChildrenCount = children.filter(
    (child) => normalizeTaskStatus(child.status) === "completed",
  ).length;
  const progress = Math.round((nodeData.taskProgress ?? 0) * 100);
  const taskStatus = normalizeTaskStatus(nodeData.taskStatus);
  const taskPriority = normalizeTaskPriority(nodeData.taskPriority);
  const taskComplexity = normalizeTaskComplexity(nodeData.taskComplexity);
  const taskUrgency = normalizeTaskUrgency(nodeData.taskUrgency);
  const isChildrenExpanded = nodeData.taskChildrenExpanded !== false;
  const onToggleTaskChildren = nodeData.onToggleTaskChildren;
  const matchingProjectTags = projectTags.filter((tag) =>
    tag.toLocaleLowerCase().includes(draftTag.trim().toLocaleLowerCase()),
  );
  const canCreateTag = Boolean(
    draftTag.trim() &&
      !projectTags.some(
        (tag) =>
          tag.toLocaleLowerCase() === draftTag.trim().toLocaleLowerCase(),
      ),
  );

  useEffect(() => {
    setDraftName(nodeData.name ?? "");
  }, [nodeData.name]);

  useEffect(() => {
    if (isAddingTag) tagInputRef.current?.focus();
  }, [isAddingTag]);

  useEffect(() => {
    if (!selected) setActiveOptionMenu(null);
  }, [selected]);

  useEffect(() => {
    if (!isChildrenExpanded) return;

    let frame = 0;
    const measure = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const sizes = readTaskContentSizes(
          headerRef.current,
          childrenPanelRef.current,
          children.length,
        );
        onToggleTaskChildren?.(
          id,
          true,
          sizes.expandedHeight,
        );
      });
    };
    const observer = new ResizeObserver(measure);
    if (headerRef.current) observer.observe(headerRef.current);
    if (childrenContentRef.current) {
      observer.observe(childrenContentRef.current);
    }
    measure();

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [
    children.length,
    id,
    isChildrenExpanded,
    onToggleTaskChildren,
    tags.length,
  ]);

  function update(
    updates: Parameters<NonNullable<CanvasNodeData["onUpdateTaskNode"]>>[1],
  ) {
    nodeData.onUpdateTaskNode?.(id, updates);
  }

  function commitName() {
    const name = draftName.trim();
    if (name !== (nodeData.name ?? "")) update({ name });
  }

  function toggleChildren() {
    const sizes = readTaskContentSizes(
      headerRef.current,
      childrenPanelRef.current,
      children.length,
    );
    onToggleTaskChildren?.(
      id,
      !isChildrenExpanded,
      sizes.expandedHeight,
    );
  }

  function selectTag(inputTag: string) {
    const tag = inputTag.trim().slice(0, MAX_TAG_LENGTH);
    setDraftTag("");
    setIsAddingTag(false);
    if (
      !tag ||
      tags.length >= MAX_TAG_COUNT ||
      tags.some(
        (existing) =>
          existing.toLocaleLowerCase() === tag.toLocaleLowerCase(),
      )
    ) {
      return;
    }
    update({ tags: [...tags, tag] });
  }

  function updateProjectTagColor(tag: string, color: CanvasTagColor) {
    setColorEditingTag(null);
    nodeData.onUpdateProjectTag?.({ type: "color", tag, color });
  }

  function renderTagColorPicker(tag: string, color: CanvasTagColor) {
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
              className={`flex size-8 items-center justify-center rounded-md hover:bg-zinc-100 ${
                color === option.value ? "bg-zinc-100" : ""
              }`}
              key={option.value}
              onClick={() => updateProjectTagColor(tag, option.value)}
              title={option.label}
              type="button"
            >
              <span
                className={`size-4 rounded-sm border ${TAG_SWATCH_CLASS_NAMES[option.value]}`}
              />
            </button>
          ))}
        </div>
      </DropdownMenuContent>
    );
  }

  return (
    <div className="group relative h-full w-full">
      <NodeTargetHandle
        id={STANDARD_NODE_TARGET_HANDLE_ID}
        revealOnHover={false}
        visible={Boolean(nodeData.hasIncomingEdge)}
      />
      <NodeEdgeSourceHandle visible={Boolean(nodeData.hasOutgoingEdge)} />
      <NodeContextHandle selected={Boolean(selected)} />
      <NodeContextTargetHandle />

      <div className="zenme-node-title-bar absolute -top-8 left-1 flex h-5 items-center gap-2 text-xs font-medium text-zinc-500">
        <span className="zenme-node-title-icon-hitbox">
          <ListTodo className="size-4" />
        </span>
        <span>任务</span>
      </div>
      <div className="absolute -top-8 right-1 flex h-5 items-center gap-3 text-[11px] text-zinc-400">
        <TaskTimestamp label="创建" value={nodeData.createdAt} />
        <TaskTimestamp label="修改" value={nodeData.updatedAt} />
      </div>

      <div
        className={`zenme-shadow-node flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border bg-white text-zinc-950 ${
          selected ? "border-zinc-900" : "border-zinc-200"
        }`}
      >
        <header
          className={`m-3 shrink-0 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 ${
            isChildrenExpanded ? "mb-0" : ""
          }`}
          ref={headerRef}
        >
          <input
            aria-label="任务名称"
            className="zenme-task-name-input nodrag nowheel w-full cursor-text select-text rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-medium caret-zinc-950 outline-none transition-colors placeholder:text-zinc-400 hover:border-zinc-300 focus:border-zinc-500"
            onBlur={commitName}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
              if (event.key === "Escape") {
                setDraftName(nodeData.name ?? "");
                event.currentTarget.blur();
              }
            }}
            placeholder="未命名任务"
            value={draftName}
          />

          <div className="mt-3 flex min-w-0 items-center gap-1.5">
            <TaskProgressRing value={progress} />
            <TaskOptionMenu
              label="状态"
              onChange={(value) => update({ taskStatus: value as TaskStatus })}
              onOpenChange={(open) =>
                setActiveOptionMenu(open ? "status" : null)
              }
              open={activeOptionMenu === "status"}
              options={STATUS_OPTIONS}
              value={taskStatus}
            />
            <TaskOptionMenu
              label="优先级"
              onChange={(value) => update({ taskPriority: value as TaskPriority })}
              onOpenChange={(open) =>
                setActiveOptionMenu(open ? "priority" : null)
              }
              open={activeOptionMenu === "priority"}
              options={PRIORITY_OPTIONS}
              value={taskPriority}
            />
            <TaskOptionMenu
              label="复杂程度"
              onChange={(value) =>
                update({ taskComplexity: value as TaskComplexity })
              }
              onOpenChange={(open) =>
                setActiveOptionMenu(open ? "complexity" : null)
              }
              open={activeOptionMenu === "complexity"}
              options={COMPLEXITY_OPTIONS}
              value={taskComplexity}
            />
            <TaskOptionMenu
              label="紧急程度"
              onChange={(value) => update({ taskUrgency: value as TaskUrgency })}
              onOpenChange={(open) =>
                setActiveOptionMenu(open ? "urgency" : null)
              }
              open={activeOptionMenu === "urgency"}
              options={URGENCY_OPTIONS}
              value={taskUrgency}
            />
            <TaskParentMenu
              onChange={(parentId) =>
                nodeData.onSetTaskParent?.(id, parentId)
              }
              onOpenChange={(open) =>
                setActiveOptionMenu(open ? "parent" : null)
              }
              open={activeOptionMenu === "parent"}
              options={parentOptions}
              parentId={nodeData.taskParentId}
            />
            <span
              aria-label={`已完成 ${completedChildrenCount} 个子任务，共 ${children.length} 个`}
              className="flex h-9 shrink-0 items-center justify-center rounded-md border border-zinc-100 bg-zinc-50 px-2 text-[11px] font-medium tabular-nums text-zinc-500"
              title={`子任务：${completedChildrenCount}/${children.length}`}
            >
              {completedChildrenCount}/{children.length}
            </span>
            <button
              aria-expanded={isChildrenExpanded}
              aria-label={isChildrenExpanded ? "收起子任务" : "展开子任务"}
              className="nodrag nowheel flex size-9 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-zinc-500 transition-colors hover:border-zinc-300 hover:bg-white hover:text-zinc-800"
              onClick={toggleChildren}
              title={isChildrenExpanded ? "收起子任务" : "展开子任务"}
              type="button"
            >
              {isChildrenExpanded ? (
                <ChevronUp className="size-4" />
              ) : (
                <ChevronDown className="size-4" />
              )}
            </button>
          </div>

          <div className="mt-3 flex min-h-7 flex-wrap items-center gap-1.5">
            <Tag className="mr-0.5 size-3.5 text-zinc-400" />
            {tags.map((tag) => {
              const color = getTagColor(tag, nodeData.projectTagColors?.[tag]);
              return (
                <DropdownMenu
                  key={tag}
                  onOpenChange={(open) => setColorEditingTag(open ? tag : null)}
                  open={colorEditingTag === tag}
                >
                  <span
                    className={`group/tag inline-flex h-6 max-w-40 items-center gap-1 rounded-md px-2 text-xs ${tagColorClassName(
                      tag,
                      color,
                    )}`}
                  >
                    <DropdownMenuTrigger asChild>
                      <button
                        className="min-w-0 truncate rounded outline-none hover:opacity-75"
                        title={`修改标签 ${tag} 的颜色`}
                        type="button"
                      >
                        {tag}
                      </button>
                    </DropdownMenuTrigger>
                    <button
                      aria-label={`移除标签 ${tag}`}
                      className="hidden shrink-0 text-current opacity-50 hover:opacity-100 group-hover/tag:block"
                      onClick={() =>
                        update({ tags: tags.filter((item) => item !== tag) })
                      }
                      type="button"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                  {renderTagColorPicker(tag, color)}
                </DropdownMenu>
              );
            })}
            {tags.length < MAX_TAG_COUNT ? (
              <DropdownMenu
                onOpenChange={(open) => {
                  setIsAddingTag(open);
                  if (!open) setDraftTag("");
                }}
                open={isAddingTag}
              >
                <DropdownMenuTrigger asChild>
                  <button
                    aria-label="添加标签"
                    className="nodrag flex size-6 items-center justify-center rounded-md border border-dashed border-zinc-300 text-zinc-400 hover:border-zinc-400 hover:text-zinc-700"
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
                      className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400"
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
                  <div className="mt-2 max-h-44 overflow-y-auto">
                    {matchingProjectTags.map((tag) => {
                      const color = getTagColor(
                        tag,
                        nodeData.projectTagColors?.[tag],
                      );
                      return (
                        <div
                          className="flex items-center gap-1 rounded-md px-1 py-1"
                          key={tag}
                        >
                          <button
                            className="flex min-w-0 flex-1 items-center rounded px-1 py-1 text-left hover:bg-zinc-100 disabled:opacity-50"
                            disabled={tags.includes(tag)}
                            onClick={() => selectTag(tag)}
                            type="button"
                          >
                            <span
                              className={`truncate rounded px-1.5 py-0.5 text-xs ${tagColorClassName(
                                tag,
                                color,
                              )}`}
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
                                className="flex size-7 shrink-0 items-center justify-center rounded hover:bg-zinc-100"
                                type="button"
                              >
                                <span
                                  className={`size-3.5 rounded-sm border ${TAG_SWATCH_CLASS_NAMES[color]}`}
                                />
                              </button>
                            </DropdownMenuTrigger>
                            {renderTagColorPicker(tag, color)}
                          </DropdownMenu>
                          <button
                            aria-label={`删除项目标签 ${tag}`}
                            className="flex size-7 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
                            onClick={() =>
                              nodeData.onUpdateProjectTag?.({
                                type: "delete",
                                tag,
                              })
                            }
                            type="button"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      );
                    })}
                    {canCreateTag ? (
                      <DropdownMenuItem
                        className="cursor-pointer"
                        onSelect={() => selectTag(draftTag)}
                      >
                        <Plus className="mr-2 size-4" />
                        创建“{draftTag.trim()}”
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

        {isChildrenExpanded ? (
          <div
            className="nowheel min-h-0 flex-1 overflow-y-auto px-5 py-4"
            ref={childrenPanelRef}
          >
            <section ref={childrenContentRef}>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-zinc-700">子任务</h3>
                <span className="text-xs text-zinc-400">{children.length} 项</span>
              </div>
              {children.length ? (
                <ul className="mt-2 divide-y divide-zinc-100 rounded-lg border border-zinc-200">
                  {children.map((child) => (
                    <li key={child.id}>
                      <button
                        aria-label={`定位子任务 ${child.name}`}
                        className="nodrag nowheel flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-zinc-50"
                        onClick={() => nodeData.onLocateTaskNode?.(child.id)}
                        title={`定位到子任务：${child.name}`}
                        type="button"
                      >
                        {normalizeTaskStatus(child.status) === "completed" ? (
                          <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                        ) : normalizeTaskStatus(child.status) === "paused" ? (
                          <CirclePause className="size-4 shrink-0 text-amber-600" />
                        ) : (
                          <span className="size-4 shrink-0 rounded-full border border-zinc-300" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-sm text-zinc-800">
                          {child.name}
                        </span>
                        <span className="shrink-0 text-xs text-zinc-400">
                          {statusLabel(normalizeTaskStatus(child.status))}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-2 rounded-lg border border-dashed border-zinc-200 px-4 py-8 text-center text-sm text-zinc-400">
                  其他任务选择当前任务为父任务后，将显示在这里
                </div>
              )}
            </section>
          </div>
        ) : null}
      </div>

      <NodeResizer
        color="#a1a1aa"
        handleClassName="zenme-text-resize-handle"
        isVisible={Boolean(selected)}
        lineClassName="zenme-text-resize-line"
        minHeight={176}
        minWidth={420}
      />
      <NodeActionHandle selected={Boolean(selected)} />
    </div>
  );
}

function readTaskContentSizes(
  header: HTMLElement | null,
  childrenPanel: HTMLElement | null,
  childCount: number,
) {
  const headerHeight = Math.ceil(header?.getBoundingClientRect().height ?? 0);
  const estimatedPanelHeight =
    32 + 20 + 8 + (childCount > 0 ? 2 + childCount * 41 : 86);
  const renderedPanelHeight = childrenPanel
    ? Math.ceil(childrenPanel.scrollHeight)
    : 0;

  return {
    expandedHeight: Math.max(
      176,
      12 +
        headerHeight +
        Math.max(estimatedPanelHeight, renderedPanelHeight) +
        2,
    ),
  };
}

function TaskProgressRing({ value }: { value: number }) {
  const normalizedValue = Math.min(100, Math.max(0, value));
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - normalizedValue / 100);

  return (
    <div
      aria-label={`任务进度 ${normalizedValue}%`}
      className="relative flex size-9 shrink-0 items-center justify-center"
      role="progressbar"
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={normalizedValue}
      title={`任务进度：${normalizedValue}%`}
    >
      <svg
        aria-hidden="true"
        className="absolute inset-0 size-full -rotate-90"
        viewBox="0 0 36 36"
      >
        <circle
          className="fill-none stroke-emerald-100"
          cx="18"
          cy="18"
          r={radius}
          strokeWidth="3"
        />
        <circle
          className="fill-none stroke-emerald-500 transition-[stroke-dashoffset]"
          cx="18"
          cy="18"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          strokeWidth="3"
        />
      </svg>
      <span className="relative text-[9px] font-semibold tabular-nums text-emerald-700">
        {normalizedValue}%
      </span>
    </div>
  );
}

function TaskOptionMenu({
  label,
  onChange,
  onOpenChange,
  open,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  options: Array<{
    content: ReactNode;
    label: string;
    tone?: string;
    value: string;
  }>;
  value: string;
}) {
  const selectedOption =
    options.find((option) => option.value === value) ?? options[0];

  return (
    <DropdownMenu onOpenChange={onOpenChange} open={open}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`${label}：${selectedOption.label}`}
          className={`nodrag nowheel flex size-9 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-sm font-medium transition-colors hover:border-zinc-300 hover:bg-white ${
            selectedOption.tone ?? "text-zinc-600"
          }`}
          title={`${label}：${selectedOption.label}`}
          type="button"
        >
          {selectedOption.content}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="nodrag nowheel flex min-w-0 gap-1 rounded-lg p-1.5"
        onCloseAutoFocus={(event) => event.preventDefault()}
        sideOffset={6}
      >
        {options.map((option) => (
          <DropdownMenuItem
            aria-label={option.label}
            className={`flex size-9 cursor-pointer items-center justify-center rounded-md p-0 ${
              value === option.value
                ? "bg-zinc-100 text-zinc-950"
                : "text-zinc-600"
            }`}
            key={option.value}
            onSelect={() => {
              onChange(option.value);
              onOpenChange(false);
            }}
            title={option.label}
          >
            <span
              className={`flex size-6 shrink-0 items-center justify-center text-xs font-medium ${
                option.tone ?? ""
              }`}
            >
              {option.content}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TaskTimestamp({ label, value }: { label: string; value?: string }) {
  const formattedValue = formatTime(value);
  return (
    <span
      aria-label={`${label} ${formattedValue}`}
      className="flex items-center gap-1 whitespace-nowrap"
      title={`${label}：${formattedValue}`}
    >
      <Clock3 className="size-3 shrink-0" />
      <span>{label} {formattedValue}</span>
    </span>
  );
}

function TaskParentMenu({
  onChange,
  onOpenChange,
  open,
  options,
  parentId,
}: {
  onChange: (parentId?: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  options: TaskParentOption[];
  parentId?: string;
}) {
  const selectedParent = options.find((option) => option.id === parentId);

  return (
    <DropdownMenu onOpenChange={onOpenChange} open={open}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`父任务：${selectedParent?.name ?? "无父任务"}`}
          className="nodrag nowheel flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-zinc-200 bg-zinc-50 px-2 text-left text-xs text-zinc-600 transition-colors hover:border-zinc-300 hover:bg-white"
          title={`父任务：${selectedParent?.name ?? "无父任务"}`}
          type="button"
        >
          <ListTree className="size-3.5 shrink-0 text-zinc-400" />
          <span className="min-w-0 flex-1 truncate">
            {selectedParent?.name ?? "选择父任务"}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-zinc-400" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="nodrag nowheel max-h-72 w-64 overflow-y-auto rounded-lg p-1.5"
        onCloseAutoFocus={(event) => event.preventDefault()}
        sideOffset={6}
      >
        <DropdownMenuItem
          className="cursor-pointer"
          onSelect={() => {
            onChange(undefined);
            onOpenChange(false);
          }}
        >
          <span className="truncate text-zinc-500">无父任务</span>
        </DropdownMenuItem>
        {options.map((option) => (
          <DropdownMenuItem
            className="cursor-pointer"
            key={option.id}
            onSelect={() => {
              onChange(option.id);
              onOpenChange(false);
            }}
          >
            <span className="min-w-0 flex-1 truncate">{option.name}</span>
            {option.id === parentId ? (
              <CheckCircle2 className="ml-2 size-4 shrink-0 text-emerald-600" />
            ) : null}
          </DropdownMenuItem>
        ))}
        {options.length === 0 ? (
          <p className="px-2 py-2 text-xs text-zinc-400">暂无其他可选任务</p>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const STATUS_OPTIONS = [
  {
    content: <Play className="size-3.5 fill-current" />,
    label: "进行中",
    tone: "text-emerald-600",
    value: "inProgress",
  },
  {
    content: <Pause className="size-3.5 fill-current" />,
    label: "暂停",
    tone: "text-amber-500",
    value: "paused",
  },
  {
    content: <CircleCheck className="size-4" />,
    label: "完成",
    tone: "text-emerald-600",
    value: "completed",
  },
];
const PRIORITY_OPTIONS = [
  { content: <PriorityIcon value="1" />, label: "优先级 1", value: "P1" },
  { content: <PriorityIcon value="2" />, label: "优先级 2", value: "P2" },
  { content: <PriorityIcon value="3" />, label: "优先级 3", value: "P3" },
];
const COMPLEXITY_OPTIONS = [
  { content: "中", label: "中等复杂度", value: "medium" },
  { content: "简", label: "简单", value: "simple" },
  { content: "繁", label: "复杂", value: "complex" },
];
const URGENCY_OPTIONS = [
  {
    content: <UrgencyIcon symbol="🧍" />,
    label: "站立：可按计划处理",
    value: "stand",
  },
  {
    content: <UrgencyIcon symbol="🚶" />,
    label: "步行：需要尽快处理",
    value: "walk",
  },
  {
    content: <UrgencyIcon symbol="🏃" />,
    label: "跑步：需要立即处理",
    value: "run",
  },
];

function UrgencyIcon({ symbol }: { symbol: "🧍" | "🚶" | "🏃" }) {
  return (
    <span aria-hidden="true" className="text-[17px] leading-none">
      {symbol}
    </span>
  );
}

function PriorityIcon({ value }: { value: "1" | "2" | "3" }) {
  const colorClassName = {
    "1": "bg-red-500",
    "2": "bg-amber-400",
    "3": "bg-blue-500",
  }[value];

  return (
    <span
      className={`flex size-5 items-center justify-center rounded-full text-[11px] font-semibold leading-none text-white shadow-sm ${colorClassName}`}
    >
      {value}
    </span>
  );
}

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
const TAG_COLORS = TAG_COLOR_OPTIONS.map((option) => option.value);

function getTagColor(tag: string, savedColor?: CanvasTagColor) {
  if (savedColor) return savedColor;
  let hash = 0;
  for (const character of tag) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return TAG_COLORS[hash % TAG_COLORS.length];
}

function tagColorClassName(tag: string, savedColor?: CanvasTagColor) {
  return TAG_COLOR_CLASS_NAMES[getTagColor(tag, savedColor)];
}

function statusLabel(status: TaskStatus) {
  return STATUS_OPTIONS.find((option) => option.value === status)?.label ?? "进行中";
}

function formatTime(value?: string) {
  if (!value) return "未记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未记录";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
