"use client";

/**
 * Any request without a bespoke form, as weft's GatePane renders it: detail, the review subject
 * (a file gets Edit/Preview and is sent back as reviewEdit when changed), attachments, then the
 * SchemaForm. approve/confirm requests are answered by the Deny / Approve buttons themselves.
 */
import { useState } from "react";
import { buildAnswer, defaultValues, isDeniable, missingRequired, type SchemaFormValues } from "@/lib/weft/schema-form";
import { useBlobText } from "@/lib/api/queries";
import { DocViewer } from "../../docs/DocViewer";
import { AttachmentTabs, type BlobItem } from "../BlobContent";
import { RequestFooter } from "../RequestFooter";
import { SchemaForm } from "../SchemaForm";
import { artifactSubject, fileSubject, type RequestFormProps } from "../types";
import { useAnswerRequest } from "../use-answer-request";
import { humanizeKey } from "@/lib/weft/schema-form";

export function GenericRequestForm({ request, projectId, compact, onAnswered }: RequestFormProps) {
  const deniable = isDeniable(request.kind);
  const [values, setValues] = useState<SchemaFormValues>(() => defaultValues(request.schema, { kind: request.kind }));
  const file = fileSubject(request);
  const fileText = useBlobText(file?.ref.$blob);
  const [edited, setEdited] = useState<string | undefined>(undefined);
  const { submit, pending, error, clearError } = useAnswerRequest({ runId: request.runId, requestId: request.id, projectId, onAnswered });

  const artifact = artifactSubject(request);
  const items: BlobItem[] = [
    ...(artifact ? [{ label: artifact.label ?? "review artifact", ref: artifact.ref, mediaType: artifact.mediaType }] : []),
    ...(request.reviewAttachments ?? []).map((a, i) => ({ label: a.label ?? `attachment ${i + 1}`, ref: a.ref, mediaType: a.mediaType })),
    ...(request.artifactRef && !request.reviewSubject ? [{ label: "attached report", ref: request.artifactRef }] : []),
  ];

  const answerFor = (approved?: boolean) => buildAnswer(request.schema, values, { kind: request.kind, confirmToken: request.confirmToken, approved });
  const preview = answerFor(deniable ? true : undefined);
  const missing = missingRequired(request.schema, preview).map((k) => `${humanizeKey(k)} is required`);
  const fileLoading = file?.mode === "edit" && !fileText.data;
  if (fileLoading) missing.push("Loading the file");
  const reviewEdit = file && file.mode === "edit" && edited !== undefined && fileText.data !== undefined && edited !== fileText.data ? { content: edited, beforeSha256: file.sha256 } : undefined;

  return (
    <div className="space-y-4">
      {request.detail ? <p className="rounded-[16px] bg-well/60 px-4 py-3 text-sm whitespace-pre-wrap text-muted-foreground">{request.detail}</p> : null}
      {request.ui ? (
        <div className="rounded-[16px] bg-well/60 px-4 py-3 text-[13px] text-muted-foreground">
          Workflow-provided view · <span className="font-mono">{request.ui.asset.id}</span> · revision {request.ui.asset.revision}. Custom views are not rendered here; use the standard form below.
        </div>
      ) : null}
      {file ? (
        <DocViewer
          title={file.path}
          text={fileText.data ?? ""}
          loading={fileText.isPending}
          editable={file.mode === "edit"}
          value={edited}
          onChange={(t) => {
            clearError();
            setEdited(t);
          }}
          compareText={edited !== undefined ? fileText.data : undefined}
          compareLabel="the file as proposed"
          toc={!compact}
          variant="panel"
          bodyClassName="max-h-[60vh]"
        />
      ) : null}
      {items.length > 0 ? <AttachmentTabs items={items} /> : null}
      <SchemaForm
        schema={request.schema}
        kind={request.kind}
        values={values}
        onChange={(v) => {
          clearError();
          setValues(v);
        }}
        disabled={pending}
      />
      <RequestFooter
        requestId={request.id}
        answer={preview}
        reviewEdit={reviewEdit}
        error={error}
        pending={pending}
        missing={missing}
        submitLabel={deniable ? "Approve & resume" : "Answer & resume"}
        onSubmit={() => submit(answerFor(deniable ? true : undefined), reviewEdit)}
        deny={deniable ? { label: "Deny & stop", onDeny: () => submit(answerFor(false), reviewEdit) } : undefined}
      />
    </div>
  );
}
