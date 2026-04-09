import { facebookIcon, instagramIcon, mailIcon, pinIcon, phoneIcon, twitterIcon } from '../../assets/icons';

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-shell">
        <header className="footer-intro">
          <h2>SMARTRIDE</h2>

          <div className="footer-intro__panel">
            <p>
              <strong>SmartRide</strong> là nền tảng đặt xe thông minh tích hợp công nghệ AI, mang đến giải pháp di
              chuyển nhanh chóng, an toàn và tiện lợi cho người dùng. Với giao diện thân thiện, dễ sử dụng cùng nhiều
              tính năng hiện đại, SmartRide giúp kết nối hành khách và tài xế một cách hiệu quả, tối ưu hóa trải
              nghiệm cho mọi hành trình hằng ngày.
            </p>
          </div>
        </header>

        <div className="footer-cards">
          <section className="footer-card footer-card--contact">
            <h3>Địa chỉ liên hệ</h3>

            <div className="footer-contact-list">
              <p className="footer-contact-row">
                <img className="footer-contact-row__icon" src={pinIcon} alt="" aria-hidden="true" />
                <span>
                  123 Anywhere St.,
                  <br />
                  Any City ST 12345
                </span>
              </p>

              <p className="footer-contact-row">
                <img className="footer-contact-row__icon" src={phoneIcon} alt="" aria-hidden="true" />
                <span>1123-456-7890</span>
              </p>

              <p className="footer-contact-row">
                <img className="footer-contact-row__icon" src={mailIcon} alt="" aria-hidden="true" />
                <span>hello@reallygreatsite.com</span>
              </p>
            </div>
          </section>

          <section className="footer-card footer-card--social">
            <h3>Kết nối với chúng tôi</h3>

            <div className="footer-social-row" aria-label="Mạng xã hội">
              <a className="footer-social-link" href="#home" aria-label="Facebook">
                <img className="footer-social-link__icon" src={facebookIcon} alt="" aria-hidden="true" />
              </a>

              <a className="footer-social-link" href="#home" aria-label="Twitter">
                <img className="footer-social-link__icon" src={twitterIcon} alt="" aria-hidden="true" />
              </a>

              <a className="footer-social-link" href="#home" aria-label="Instagram">
                <img className="footer-social-link__icon" src={instagramIcon} alt="" aria-hidden="true" />
              </a>
            </div>

            <p className="footer-social-note">Đừng quên gắn thẻ #SmartRide để chia sẻ khoảnh khắc của bạn!</p>
          </section>

          <section className="footer-card footer-card--policy">
            <h3>Điều khoản &amp; Chính sách</h3>

            <ul className="footer-policy-list">
              <li>Điều khoản sử dụng</li>
              <li>Chính sách bảo mật</li>
              <li>Chính sách hủy phòng</li>
              <li>Quy định &amp; hỗ trợ khách hàng</li>
            </ul>
          </section>
        </div>
      </div>
    </footer>
  );
}
