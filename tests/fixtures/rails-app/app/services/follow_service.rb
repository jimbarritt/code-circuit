class FollowService < BaseService
  def call(source, target)
    Follow.create!(account: source, target_account: target)
    LocalNotificationWorker.perform_async(target.id)
    ActivityPub::DeliveryWorker.perform_async(source.id, target.inbox_url)
  end
end
