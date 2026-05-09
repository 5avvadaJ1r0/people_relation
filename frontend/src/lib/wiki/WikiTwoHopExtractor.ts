import React, { Component } from "react";
import type { PersonRef, RelationView } from "../types";

export type WikiProgress = { phase: string; done: number; total: number };

export type WikiTwoHopExtractorState = {
  busy: boolean;
  progress: WikiProgress | null;
  error: string | null;
  result: { master: PersonRef; relations: RelationView[] } | null;
};

export type WikiTwoHopExtractorProps = {
  masterTitle: string;
  masterName: string;
  maxRelated: number;
  enabled?: boolean;
  onProgress?: (p: WikiProgress | null) => void;
  onError?: (message: string | null) => void;
  onResult?: (r: { master: PersonRef; relations: RelationView[] } | null) => void;
  /** enabled=true かつ props が変わったら自動実行 */
  autoRun?: boolean;
  extractRelationsTwoHop: (params: {
    masterTitle: string;
    masterName: string;
    maxRelated: number;
    onProgress?: (p: WikiProgress) => void;
  }) => Promise<{ master: PersonRef; relations: RelationView[] }>;
};

export class WikiTwoHopExtractor extends Component<WikiTwoHopExtractorProps, WikiTwoHopExtractorState> {
  static defaultProps: Partial<WikiTwoHopExtractorProps> = {
    enabled: true,
    autoRun: true,
  };

  private runSeq = 0;
  private cancelledSeq: number | null = null;

  state: WikiTwoHopExtractorState = {
    busy: false,
    progress: null,
    error: null,
    result: null,
  };

  componentDidMount(): void {
    if (this.props.enabled && this.props.autoRun) void this.run();
  }

  componentDidUpdate(prev: WikiTwoHopExtractorProps): void {
    const shouldAuto =
      (this.props.enabled ?? true) &&
      (this.props.autoRun ?? true) &&
      (prev.masterTitle !== this.props.masterTitle ||
        prev.masterName !== this.props.masterName ||
        prev.maxRelated !== this.props.maxRelated ||
        prev.enabled !== this.props.enabled);
    if (shouldAuto) void this.run();
  }

  private emit() {
    this.props.onProgress?.(this.state.progress);
    this.props.onError?.(this.state.error);
    this.props.onResult?.(this.state.result);
  }

  reset = () => {
    this.cancelledSeq = null;
    this.setState({ busy: false, progress: null, error: null, result: null }, () => this.emit());
  };

  cancel = () => {
    this.cancelledSeq = this.runSeq;
    this.setState({ busy: false, progress: null }, () => this.emit());
  };

  run = async () => {
    const seq = ++this.runSeq;
    this.cancelledSeq = null;
    this.setState(
      { busy: true, progress: { phase: "主体者情報取得処理中", done: 0, total: 1 }, error: null, result: null },
      () => this.emit()
    );
    try {
      const out = await this.props.extractRelationsTwoHop({
        masterTitle: this.props.masterTitle,
        masterName: this.props.masterName,
        maxRelated: this.props.maxRelated,
        onProgress: (p) => {
          if (this.cancelledSeq === seq) return;
          this.setState({ progress: p }, () => this.props.onProgress?.(p));
        },
      });
      if (this.cancelledSeq === seq) return;
      this.setState({ result: out }, () => this.props.onResult?.(out));
    } catch (e: any) {
      if (this.cancelledSeq === seq) return;
      const msg = e?.message ?? String(e);
      this.setState({ error: msg }, () => this.props.onError?.(msg));
    } finally {
      if (this.cancelledSeq === seq) return;
      this.setState({ busy: false }, () => this.emit());
    }
  };

  render() {
    return null;
  }
}

