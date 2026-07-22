"use client";

import { useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type ImageVersion = { versionNumber: number; blobUrl: string };

/**
 * Side-by-side image comparison — IMAGE only, per Slice 3 scope (PDF/video
 * comparison deferred to a future slice). Defaults to the two most recent
 * versions; either side is independently switchable.
 */
export function VersionCompareDialog({
  versions,
  trigger,
}: {
  versions: ImageVersion[];
  trigger: React.ReactElement;
}) {
  const sorted = [...versions].sort((a, b) => b.versionNumber - a.versionNumber);
  const [leftNum, setLeftNum] = useState(sorted[1]?.versionNumber ?? sorted[0]?.versionNumber);
  const [rightNum, setRightNum] = useState(sorted[0]?.versionNumber);

  const left = sorted.find((v) => v.versionNumber === leftNum) ?? sorted[1] ?? sorted[0];
  const right = sorted.find((v) => v.versionNumber === rightNum) ?? sorted[0];

  return (
    <Dialog>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Compare versions</DialogTitle>
          <DialogDescription>Side-by-side image comparison.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          {[
            { version: left, num: leftNum, setNum: setLeftNum },
            { version: right, num: rightNum, setNum: setRightNum },
          ].map((side, i) => (
            <div key={i} className="space-y-2">
              <select
                value={side.num}
                onChange={(e) => side.setNum(Number(e.target.value))}
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              >
                {sorted.map((v) => (
                  <option key={v.versionNumber} value={v.versionNumber}>
                    Version {v.versionNumber}
                  </option>
                ))}
              </select>
              <div className="overflow-hidden rounded-lg border bg-muted/30">
                {side.version ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={side.version.blobUrl} alt={`Version ${side.version.versionNumber}`} className="block w-full" />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
