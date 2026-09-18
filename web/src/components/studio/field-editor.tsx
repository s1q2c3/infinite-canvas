import { useState, type ReactNode } from "react";
import { X } from "lucide-react";

import { formatFields, type FieldSpec } from "@/lib/director/spec";

/**
 * 通用字段编辑弹窗。
 *
 * 卡片上只放最关键的几个字段，其余全在这里改 —— 改完仍然写回节点文字，
 * 保持「节点文字是唯一真相」这条既有约定，不另存一份结构化数据。
 */
export function FieldEditor({
    title,
    fields,
    values,
    onSave,
    onClose,
    footer,
}: {
    title: string;
    fields: FieldSpec[];
    values: Record<string, string>;
    onSave: (values: Record<string, string>) => void;
    onClose: () => void;
    footer?: ReactNode;
}) {
    const [draft, setDraft] = useState<Record<string, string>>(() => ({ ...values }));

    return (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6" onMouseDown={onClose}>
            <div
                className="flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#141418] shadow-2xl"
                onMouseDown={(event) => event.stopPropagation()}
            >
                <header className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-3">
                    <span className="text-sm font-semibold text-stone-100">{title}</span>
                    <button type="button" onClick={onClose} className="grid size-7 place-items-center rounded-lg text-stone-400 hover:bg-white/10 hover:text-stone-100">
                        <X className="size-4" />
                    </button>
                </header>

                <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-4">
                    <div className="flex flex-col gap-3">
                        {fields.map((field) => (
                            <label key={field.key} className="flex flex-col gap-1">
                                <span className="text-[11px] text-stone-400">
                                    {field.label}
                                    {field.required ? <span className="ml-1 text-red-400">*</span> : null}
                                </span>
                                <textarea
                                    value={draft[field.key] || ""}
                                    onChange={(event) => setDraft((prev) => ({ ...prev, [field.key]: event.target.value }))}
                                    rows={field.key === "visual" || field.key === "imagePrompt" || field.key === "appearance" ? 3 : 1}
                                    className="thin-scrollbar resize-y rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-[12px] leading-5 text-stone-100 outline-none focus:border-violet-500/60"
                                />
                            </label>
                        ))}
                    </div>
                    {footer}
                </div>

                <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-white/10 px-5 py-3">
                    <button type="button" onClick={onClose} className="rounded-lg border border-white/15 px-4 py-1.5 text-xs text-stone-300 hover:bg-white/10">
                        取消
                    </button>
                    <button type="button" onClick={() => onSave(draft)} className="rounded-lg bg-violet-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-violet-500">
                        保存
                    </button>
                </footer>
            </div>
        </div>
    );
}

/** 把字段值渲染回节点文字（编辑弹窗保存时用）。 */
export function fieldsToText(fields: FieldSpec[], values: Record<string, string>) {
    return formatFields(fields, values);
}
