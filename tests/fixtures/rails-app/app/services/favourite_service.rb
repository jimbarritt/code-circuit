class FavouriteService < BaseService
  def call(account, status)
    Favourite.create!(account: account, status: status)
    LocalNotificationWorker.perform_async(status.id)
    ActivityPub::DistributionWorker.perform_async(status.id)
  end
end
