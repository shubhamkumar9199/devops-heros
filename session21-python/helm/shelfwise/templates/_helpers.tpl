{{- define "shelfwise.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "shelfwise.fullname" -}}
{{- if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "shelfwise.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
app.kubernetes.io/name: {{ include "shelfwise.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: shelfwise
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{/* Selector labels for one tier: include "shelfwise.selector" (list $ "backend") */}}
{{- define "shelfwise.selector" -}}
{{- $root := index . 0 -}}
app.kubernetes.io/name: {{ include "shelfwise.name" $root }}
app.kubernetes.io/instance: {{ $root.Release.Name }}
app.kubernetes.io/component: {{ index . 1 }}
{{- end -}}

{{/* No deploy without a commit SHA: CI writes the tags, nothing defaults to "latest". */}}
{{- define "shelfwise.backendImage" -}}
{{- printf "%s:%s" .Values.backend.image.repository (required "backend.image.tag is required (a commit SHA)" .Values.backend.image.tag) -}}
{{- end -}}

{{- define "shelfwise.frontendImage" -}}
{{- printf "%s:%s" .Values.frontend.image.repository (required "frontend.image.tag is required (a commit SHA)" .Values.frontend.image.tag) -}}
{{- end -}}

{{- define "shelfwise.dbSecretName" -}}
{{- default (printf "%s-db" (include "shelfwise.fullname" .)) .Values.database.existingSecret -}}
{{- end -}}

{{/* Pod Security "restricted" for every pod in the chart. */}}
{{- define "shelfwise.podSecurity" -}}
runAsNonRoot: true
runAsUser: {{ .uid }}
runAsGroup: {{ .uid }}
{{- if .fsGroup }}
fsGroup: {{ .fsGroup }}
{{- end }}
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{- define "shelfwise.containerSecurity" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: ["ALL"]
{{- end -}}

{{/* Environment shared by the API and the hold-expiry job. */}}
{{- define "shelfwise.backendEnv" -}}
- name: DB_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "shelfwise.dbSecretName" . }}
      key: {{ .Values.database.existingSecretKey }}
- name: APP_VERSION
  value: {{ .Values.backend.image.tag | trunc 12 | quote }}
- name: POD_NAME
  valueFrom:
    fieldRef:
      fieldPath: metadata.name
{{- end -}}
