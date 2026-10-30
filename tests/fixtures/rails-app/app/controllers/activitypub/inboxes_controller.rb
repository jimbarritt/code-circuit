class ActivityPub::InboxesController < ApplicationController
  def create
    ActivityPub::ProcessingWorker.perform_async(signed_request_account.id, body)
    head 202
  end
end
