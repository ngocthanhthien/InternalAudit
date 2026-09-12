# Triển khai Internal Audit

- Website chính: https://ild-internal-audit-api.dangthanhbinh53.workers.dev
- Repository: https://github.com/ngocthanhthien/InternalAudit
- Worker: `ild-internal-audit-api`
- D1: `ild-internal-audit` (ID đã điền trong `wrangler.toml`)
- Realtime: Durable Object `SyncHub`, binding `SYNC_HUB`.

GitHub Pages là địa chỉ chuyển tiếp bằng liên kết và xuất dữ liệu cũ, không phải website có API. Dùng website Cloudflare để đăng nhập và làm việc.

Mã đã được triển khai bằng Wrangler từ máy quản trị. Chưa bật tự động triển khai sau mỗi GitHub push. Để cập nhật: `python build.py`, `npm test`, sau đó `npx wrangler deploy`.

Khóa ký phiên đăng nhập được đặt bằng Cloudflare Worker Secret `AUTH_SECRET`, không nằm trong repository. Tài khoản đăng nhập nằm trong bảng D1 `users`. Không đăng mật khẩu, SQL tạo tài khoản hoặc bản backup dữ liệu vào repo.

Lần đầu dùng app: đăng nhập tài khoản quản trị, nhập JSON từ app cũ, kiểm tra số liệu và chờ trạng thái Cloudflare xác nhận trước khi dùng trên máy thứ hai.
