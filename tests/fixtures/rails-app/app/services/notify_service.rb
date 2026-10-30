class NotifyService < BaseService
  def call(recipient, activity)
    Notification.create!(account: recipient, activity: activity)
    Webpush.payload_send(message: 'new', endpoint: recipient.push_endpoint)
  end
end
