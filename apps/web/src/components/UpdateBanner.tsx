import { RefreshCw, X } from "lucide-react";

/**
 * "有新版本"的一条横条。
 *
 * 放在顶栏下面、正文上面，不悬浮、不遮任何东西：
 * 它是一个可以稍后再处理的事，不该盖住孩子正在看的名字或按钮。
 */
export default function UpdateBanner({
  onUpdate,
  onDismiss,
}: {
  onUpdate: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      data-testid="app-update-banner"
      role="status"
      className="flex shrink-0 items-center gap-3 border-b border-teal/25 bg-teal/10 px-3 py-2 md:px-7"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-teal/15 text-teal">
        <RefreshCw size={15} />
      </span>
      <p className="min-w-0 flex-1 text-xs leading-5 text-teal-deep">
        <span className="font-bold">有新版本了</span>
        <span className="text-teal-deep/80">　点一下就用上最新版本</span>
      </p>
      <button
        type="button"
        onClick={onUpdate}
        aria-label="更新到新版本"
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-teal px-3.5 text-xs font-bold text-white transition active:scale-95"
      >
        <RefreshCw size={13} />
        更新
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="稍后再说"
        title="稍后再说"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-teal-deep/60 transition hover:bg-teal/10"
      >
        <X size={15} />
      </button>
    </div>
  );
}
