import { Component } from 'react';

export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error) {
    console.error('App crashed.', error);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '2rem', background: '#eef3ef', color: '#101820', fontFamily: 'Space Grotesk, sans-serif' }}>
          <div style={{ width: 'min(720px, 100%)', borderRadius: '24px', padding: '2rem', background: '#fff', boxShadow: '0 20px 50px rgba(12, 20, 28, 0.16)' }}>
            <h1 style={{ margin: '0 0 0.75rem', fontFamily: 'Fraunces, serif', fontSize: '2.2rem' }}>SmartRide gặp lỗi</h1>
            <p style={{ margin: 0, lineHeight: 1.7, color: '#5b6672' }}>Ứng dụng đã gặp lỗi runtime. Hãy tải lại trang để tiếp tục, hoặc đóng modal và thử lại thao tác tìm địa điểm.</p>
            <button type="button" onClick={this.handleReload} style={{ marginTop: '1.25rem', padding: '0.9rem 1.2rem', borderRadius: '999px', background: 'linear-gradient(90deg, #12a2b8 0%, #84e04b 100%)', color: '#fff', fontWeight: 700 }}>
              Tải lại trang
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}