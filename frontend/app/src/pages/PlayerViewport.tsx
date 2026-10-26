import { Component, createRef, type ReactNode } from 'react';

type Props = { contentKey: string | null; hidden: boolean; children: ReactNode };
type ScrollSnapshot = { scroller: HTMLElement; top: number; height: number } | null;

/** Keep the scroll range intact while one song's player is replaced by the next. */
export default class PlayerViewport extends Component<Props> {
  private panel = createRef<HTMLElement>();

  getSnapshotBeforeUpdate(previous: Props): ScrollSnapshot {
    if (previous.contentKey === this.props.contentKey || previous.hidden || this.props.hidden) return null;
    const panel = this.panel.current;
    const scroller = panel?.closest<HTMLElement>('.iframe-page--overlay');
    return panel && scroller ? { scroller, top: scroller.scrollTop, height: panel.getBoundingClientRect().height } : null;
  }

  componentDidUpdate(_previous: Props, _state: unknown, snapshot: ScrollSnapshot) {
    const panel = this.panel.current;
    if (!panel) return;
    // A replacement can finish while Settings is open; release its placeholder too.
    if (this.props.contentKey !== null) panel.style.minHeight = '';
    if (!snapshot) return;
    // Snapshot before React removes the old player; restore before the browser
    // paints. A keyed remount or asynchronous loading gap must not jump to the top.
    if (this.props.contentKey === null) panel.style.minHeight = `${snapshot.height}px`;
    snapshot.scroller.scrollTop = snapshot.top;
  }

  render() {
    return <section ref={this.panel} className="iframe-player-view" hidden={this.props.hidden} aria-label="Player">
      {this.props.children}
    </section>;
  }
}
