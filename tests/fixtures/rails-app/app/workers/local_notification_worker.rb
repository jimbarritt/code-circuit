class LocalNotificationWorker
  include Sidekiq::Worker

  def perform(id)
    NotifyService.new.call(Account.find(id), nil)
  end
end
