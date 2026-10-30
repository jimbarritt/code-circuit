class ProcessMentionsService < BaseService
  def call(status)
    Account.find_by(username: status.mentions)
    LocalNotificationWorker.perform_async(status.id)
  end
end
